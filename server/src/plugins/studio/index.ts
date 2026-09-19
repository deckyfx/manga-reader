/**
 * Studio API: review and edit translated pages, then publish them to open extension tabs.
 *
 * GET   /studio/api/pages                        recent pages
 * POST  /studio/api/pages                        new page from an upload or image URL (progress: /api/translate-page/:id/events)
 * GET   /studio/api/pages/:id                    page, stage state and blocks
 * DELETE /studio/api/pages/:id                   discard the page: its row, stages, blocks and image folder
 * GET   /studio/api/pages/:id/files/:file        a stage image
 * POST  /studio/api/pages/:id/blocks             add a region drawn in the Studio (rect / ellipse / polygon)
 * PUT   /studio/api/pages/:id/blocks/:idx        move / resize / reshape a region
 * DELETE /studio/api/pages/:id/blocks/:idx       remove a region
 * PATCH /studio/api/pages/:id/blocks/:idx        edit source text / translation / include-in-cleaning / lettering style (marks later stages stale)
 * GET   /studio/api/fonts/:variant               a lettering font (regular / bold / italic), for the Studio's live preview
 * POST  /studio/api/pages/:id/place              find and store each block's text area (no burn), for the live preview
 * PUT   /studio/api/pages/:id/mask/:layer        save a painted mask layer (add / erase) as a PNG
 * DELETE /studio/api/pages/:id/mask/:layer       clear a painted mask layer
 * POST  /studio/api/pages/:id/reclean            re-clean only some areas of the latest cleaned page
 * POST  /studio/api/pages/:id/run                re-run ocr / translate (all or some blocks), clean_text / clean_sfx, or render
 * POST  /studio/api/pages/:id/rerun              run the whole pipeline again from the page's stored original
 * POST  /studio/api/pages/:id/publish            snapshot the result and push it to extension tabs showing the page
 * GET   /studio/api/pages/:id/history            published snapshots, newest first
 * GET   /studio/api/pages/:id/history/:revision  a snapshot image
 * POST  /studio/api/pages/:id/rollback           publish an earlier snapshot again
 *
 * Mutations of one page (edit, run, publish, rollback) run under a per-page lock so their steps never interleave.
 */
import Elysia, { t } from "elysia";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Page, PageStageRow } from "@/db/schema";
import { childLogger } from "@/lib/logger";
import { ErrBody, optionalEnum } from "@/lib/schemas";
import { runExclusiveResult, withPageLock } from "@/queue/page-queue";
import { fetchImage } from "@/services/image-fetch";
import { enginesNotReady, pageEngines } from "@/services/page-engines";
import { hasUnpublishedEdits, historyFile, listHistory, publishedFile, restoreResult } from "@/services/page-history";
import { pageLocation, pageLocations } from "@/services/page-location";
import { publishPage } from "@/services/page-publish";
import { decodeBase64Image, runStoredPage, submitPageJob } from "@/services/page-jobs";
import { MASK_LAYER_FILES, PagePipeline, type BlockShape, type PageBlock } from "@/services/page-pipeline";
import { FONT_FILES } from "@/services/typeset-service";
import { FONT_VARIANTS, TEXT_ALIGNS } from "@/shared/typeset";
import { imageSize, maskFromImage, maskToPng } from "@/lib/mask";
import { PAGE_JOBS_DIR, pageDir, PageStore, type StageName } from "@/stores/page-store";

const log = childLogger("studio");

/** Images a page folder may hold; anything else is refused. */
const PAGE_FILES = [
  "original.png", "overlay.png", "mask.png", "mask-add.png", "mask-erase.png",
  "clean-text.png", "clean-sfx.png", "render-overlay.png", "result.png",
] as const;

/** Stages the Studio can re-run, and the stages each run makes stale. */
const RUNNABLE = {
  ocr: ["translate", "render"],
  translate: ["render"],
  // Re-cleaning text removes the sound-effect pass built on top of it
  clean_text: ["clean_sfx", "render"],
  clean_sfx: ["render"],
  render: [],
} as const satisfies Record<string, readonly StageName[]>;

/** Largest encoded mask layer accepted (a 1-bit page PNG is far smaller). */
const MAX_MASK_BYTES = 8 * 1024 * 1024;

const AreaSchema = t.Object({
  x: t.Integer({ minimum: 0 }),
  y: t.Integer({ minimum: 0 }),
  w: t.Integer({ minimum: 1 }),
  h: t.Integer({ minimum: 1 }),
});
type RunnableStage = keyof typeof RUNNABLE;

const IdParam = t.String({ pattern: "^[A-Za-z0-9-]+$" });
const IdParams = t.Object({ id: IdParam });

const BoxSchema = t.Object({ x: t.Number(), y: t.Number(), w: t.Number(), h: t.Number() });

const HexColor = t.String({ pattern: "^#[0-9a-fA-F]{6}$" });

/** Lettering overrides; see TextStyle in @/shared/typeset. */
const StyleSchema = t.Object({
  font: optionalEnum(FONT_VARIANTS),
  font_size: t.Optional(t.Integer({ minimum: 6, maximum: 400 })),
  fill: t.Optional(HexColor),
  stroke: t.Optional(HexColor),
  stroke_width: t.Optional(t.Number({ minimum: 0, maximum: 60 })),
  align: optionalEnum(TEXT_ALIGNS),
  line_height: t.Optional(t.Number({ minimum: 0.6, maximum: 3 })),
  uppercase: t.Optional(t.Boolean()),
  rotation: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
  box: t.Optional(t.Object({
    x: t.Integer({ minimum: 0 }),
    y: t.Integer({ minimum: 0 }),
    w: t.Integer({ minimum: 4 }),
    h: t.Integer({ minimum: 4 }),
  })),
  offset: t.Optional(t.Object({
    x: t.Integer({ minimum: -20000, maximum: 20000 }),
    y: t.Integer({ minimum: -20000, maximum: 20000 }),
  })),
}, { additionalProperties: false });

const StoredAreaSchema = t.Object({ bound: BoxSchema, dark: t.Boolean(), mask: t.Array(t.Integer()) });

const PointSchema = t.Object({ x: t.Number(), y: t.Number() });

const ShapeSchema = t.Union([
  t.Object({ type: t.Literal("rect") }),
  t.Object({ type: t.Literal("ellipse") }),
  t.Object({ type: t.Literal("polygon"), points: t.Array(PointSchema, { minItems: 3, maxItems: 500 }) }),
]);

/** Box and optional outline of a region drawn or edited in the Studio, in page pixels. */
const GeometryBody = {
  x: t.Integer({ minimum: 0 }),
  y: t.Integer({ minimum: 0 }),
  w: t.Integer({ minimum: 1 }),
  h: t.Integer({ minimum: 1 }),
  shape: t.Optional(ShapeSchema),
};

/** Stages a block's geometry feeds: text blocks are read, translated and cleaned; sfx blocks are only cleaned. */
const stagesAffectedBy = (kind: string): StageName[] =>
  // The sound-effect pass cleans on top of clean-text.png, so anything that outdates the text pass outdates it too
  kind === "sfx" ? ["clean_sfx", "render"] : ["ocr", "translate", "clean_text", "clean_sfx", "render"];

/** Why a geometry doesn't fit the page (box outside, or polygon points outside the box), or null when it's valid. */
function geometryError(page: Page, geometry: { x: number; y: number; w: number; h: number; shape?: BlockShape }): string | null {
  if (page.width === 0 || page.height === 0) return "page has no detected size yet";
  if (geometry.x + geometry.w > page.width || geometry.y + geometry.h > page.height) return "region extends outside the page";
  if (geometry.shape?.type === "polygon") {
    const points = geometry.shape.points;
    const outside = points.some((p) =>
      p.x < geometry.x - 1 || p.y < geometry.y - 1 || p.x > geometry.x + geometry.w + 1 || p.y > geometry.y + geometry.h + 1);
    if (outside) return "polygon points must lie inside the region's box";
    // All points on one line (or repeated) enclose nothing to crop or clean. The test is "some point is off the
    // line through two distinct points", not the signed shoelace area: a symmetric bow tie has zero signed area
    // but does enclose pixels. Self-intersecting outlines are allowed: stages use the bounding box.
    const first = points[0];
    const second = points.find((p) => p.x !== first.x || p.y !== first.y);
    const offLine = second !== undefined && points.some((p) =>
      (second.x - first.x) * (p.y - first.y) - (second.y - first.y) * (p.x - first.x) !== 0);
    if (!offLine) return "polygon has no area (its points lie on one line)";
  }
  return null;
}

const PageLocationSchema = t.Object({
  series_id: t.Integer(),
  series_title: t.String(),
  chapter_id: t.Integer(),
  chapter_title: t.String(),
  chapter_number: t.Nullable(t.String()),
  index: t.Integer(),
  total: t.Integer(),
});

const PageSummary = t.Object({
  id: t.String(),
  source: t.String(),
  width: t.Integer(),
  height: t.Integer(),
  status: t.String(),
  error: t.Nullable(t.String()),
  clean_sfx: t.Boolean(),
  revision: t.Integer(),
  created_at: t.String(),
  updated_at: t.String(),
  has_result: t.Boolean(),
  /** Published at least once: this is the version readers get. */
  published: t.Boolean(),
  /** The current burn is newer than the last publish, so readers can't see it yet. */
  has_edits: t.Boolean(),
  /** Chapter the page belongs to; null = Inbox. */
  chapter_id: t.Nullable(t.Integer()),
  name: t.Nullable(t.String()),
  /** Series, chapter and reading position, for pages filed into a chapter. */
  location: t.Optional(t.Nullable(PageLocationSchema)),
});

const StageSchema = t.Object({
  stage: t.String(),
  status: t.String(),
  file: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
  updated_at: t.String(),
});

const BlockSchema = t.Object({
  id: t.Integer(),
  kind: t.String(),
  x: t.Number(),
  y: t.Number(),
  w: t.Number(),
  h: t.Number(),
  include: t.Boolean(),
  source_text: t.Nullable(t.String()),
  translated_text: t.Nullable(t.String()),
  render: t.Nullable(t.Object({ font_size: t.Number(), lines: t.Array(t.String()), area: BoxSchema, fits: t.Boolean() })),
  /** Region outline; null for plain rectangles. */
  shape: t.Nullable(ShapeSchema),
  /** Lettering overrides; null means automatic. */
  style: t.Nullable(StyleSchema),
  /** Where the last render placed the text (run-length mask), for the live preview; null before a render. */
  area: t.Nullable(StoredAreaSchema),
});

const PageDetail = t.Object({ page: PageSummary, stages: t.Array(StageSchema), blocks: t.Array(BlockSchema) });

const PublishResult = t.Object({ revision: t.Integer(), notified: t.Integer() });

function toSummary(page: Page) {
  return {
    id: page.id,
    source: page.source,
    width: page.width,
    height: page.height,
    status: page.status,
    error: page.errorMessage,
    clean_sfx: page.cleanSfx,
    revision: page.revision,
    created_at: page.createdAt,
    updated_at: page.updatedAt,
    has_result: existsSync(join(pageDir(page.id), "result.png")),
    published: publishedFile(page.id) !== null,
    has_edits: hasUnpublishedEdits(page.id),
    chapter_id: page.chapterId,
    name: page.name,
  };
}

function toStage(row: PageStageRow) {
  return { stage: row.stage, status: row.status, file: row.file, error: row.errorMessage, updated_at: row.updatedAt };
}

function toBlock(block: PageBlock) {
  return { ...block, render: block.render ?? null, shape: block.shape ?? null, style: block.style ?? null, area: block.area ?? null };
}

/** Everything the page editor shows, or null when the page doesn't exist. */
async function pageDetail(id: string) {
  const page = await PageStore.findById(id);
  if (!page) return null;
  const [stages, job, location] = await Promise.all([PageStore.listStages(id), PageStore.readJob(id), pageLocation(page)]);
  return { page: { ...toSummary(page), location }, stages: stages.map(toStage), blocks: (job?.blocks ?? []).map(toBlock) };
}

/** Why a page can't be edited right now (missing, or still running in the pipeline), as a status + message. */
async function editablePage(id: string): Promise<{ page: Page } | { code: 404 | 409; error: string }> {
  const page = await PageStore.findById(id);
  if (!page) return { code: 404, error: "page not found" };
  if (page.status === "queued" || page.status === "running") return { code: 409, error: "page is still being translated" };
  return { page };
}

export const studioPlugin = new Elysia({ prefix: "/studio/api" })
  .get(
    "/pages",
    async ({ query }) => {
      const pages = await PageStore.listFiltered({
        filed: query.filed ?? "inbox",
        ...(query.chapter_id !== undefined ? { chapterId: query.chapter_id } : {}),
        ...(query.q !== undefined ? { search: query.q } : {}),
      });
      const located = await pageLocations(pages);
      return pages.map((page) => ({ ...toSummary(page), location: located.get(page.id) ?? null }));
    },
    {
      query: t.Object({
        /** Which pages to list: the Inbox (default), the ones inside chapters, or both. */
        filed: optionalEnum(["inbox", "chapter", "all"] as const),
        chapter_id: t.Optional(t.Integer({ minimum: 1 })),
        q: t.Optional(t.String({ maxLength: 200 })),
      }),
      response: { 200: t.Array(PageSummary) },
    },
  )

  .post(
    "/pages",
    async ({ body, status }) => {
      if ((body.image === undefined) === (body.url === undefined)) return status(422, { error: "provide either an image or an image URL" });
      const options = { cleanSfx: body.clean_sfx ?? false, force: body.force ?? false };
      const { image, url } = body;
      const result = image !== undefined
        ? await submitPageJob(async () => decodeBase64Image(image), { ...options, source: "upload" })
        : await submitPageJob(() => fetchImage(url ?? ""), { ...options, source: url ?? "" });
      if (result.ok) return status(202, { job_id: result.job_id, cached: result.cached });
      switch (result.code) {
        case 400: return status(400, { error: result.error });
        case 409: return status(409, { error: result.error });
        case 429: return status(429, { error: result.error });
        case 503: return status(503, { error: result.error });
      }
    },
    {
      body: t.Object({
        /** Base64 or data URL of the page image. */
        image: t.Optional(t.String()),
        /** http(s) URL the server downloads the page from. */
        url: t.Optional(t.String({ maxLength: 4096 })),
        clean_sfx: t.Optional(t.Boolean()),
        force: t.Optional(t.Boolean()),
      }),
      response: {
        202: t.Object({ job_id: t.String(), cached: t.Boolean() }),
        400: ErrBody,
        409: ErrBody,
        422: ErrBody,
        429: ErrBody,
        503: ErrBody,
      },
    },
  )

  .get(
    "/pages/:id",
    async ({ params, status }) => (await pageDetail(params.id)) ?? status(404, { error: "page not found" }),
    { params: IdParams, response: { 200: PageDetail, 404: ErrBody } },
  )

  .delete(
    "/pages/:id",
    ({ params, query, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      // Deleting a page that belongs to a chapter takes it out of what people read, so the caller has to mean it
      if (check.page.chapterId !== null && !query.force) {
        return status(409, { error: "this page belongs to a chapter — remove it from the chapter, or delete it with force" });
      }
      // Only ever this page's own folder: the resolved path must be exactly <jobs dir>/<id>
      const jobsDir = resolve(PAGE_JOBS_DIR);
      const dir = resolve(pageDir(params.id));
      if (dirname(dir) !== jobsDir || basename(dir) !== params.id) return status(409, { error: "refusing to delete an unexpected path" });
      // Failure-safe order: move the folder aside, delete the row, then remove the moved folder.
      // If the row delete fails, the folder is put back so the page stays complete.
      const parked = existsSync(dir) ? join(jobsDir, `${params.id}.deleting-${Date.now()}`) : null;
      if (parked) await rename(dir, parked);
      try {
        await PageStore.deletePage(params.id);
      } catch (err) {
        if (parked) await rename(parked, dir).catch((restoreErr: unknown) => log.error({ err: restoreErr, pageId: params.id, parked }, "Couldn't restore the page folder"));
        throw err;
      }
      // The page is already deleted: cleanup is best-effort, and leftovers are swept at the next server start
      if (parked) {
        await rm(parked, { recursive: true, force: true }).catch((err: unknown) =>
          log.warn({ err, pageId: params.id, parked }, "Couldn't remove the deleted page's folder; it will be swept at next start"));
      }
      log.info({ pageId: params.id }, "Page deleted");
      return { deleted: params.id };
    }),
    {
      params: IdParams,
      query: t.Object({ force: t.Optional(t.Boolean()) }),
      response: { 200: t.Object({ deleted: t.String() }), 404: ErrBody, 409: ErrBody },
    },
  )

  .get(
    "/fonts/:variant",
    ({ params }) => new Response(Bun.file(FONT_FILES[params.variant]), {
      headers: { "content-type": "font/ttf", "cache-control": "public, max-age=86400" },
    }),
    { params: t.Object({ variant: t.UnionEnum([...FONT_VARIANTS]) }) },
  )

  .get(
    "/pages/:id/files/:file",
    async ({ params, status, set }) => {
      const file = Bun.file(join(pageDir(params.id), params.file));
      if (!(await file.exists())) return status(404, { error: "file not found" });
      set.headers["Cache-Control"] = "no-cache";
      return file;
    },
    { params: t.Object({ id: IdParam, file: t.UnionEnum(PAGE_FILES) }) },
  )

  .patch(
    "/pages/:id/blocks/:idx",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      if (body.source_text === undefined && body.translated_text === undefined && body.include === undefined && body.style === undefined) {
        return status(422, { error: "nothing to update" });
      }
      const box = body.style?.box;
      if (box && (box.x + box.w > check.page.width || box.y + box.h > check.page.height)) {
        return status(422, { error: "text box extends outside the page" });
      }
      const block = (await PageStore.readJob(params.id))?.blocks.find((b) => b.id === params.idx);
      if (!block) return status(404, { error: "block not found" });
      // A new source text makes its translation stale too; a new translation only needs typesetting again; toggling
      // whether a block is cleaned affects its clean pass (text cleaning also feeds the sfx pass) and the result.
      // The edit and the stale marking commit together.
      const stale = new Set<StageName>();
      if (body.source_text !== undefined) stale.add("translate").add("render");
      if (body.translated_text !== undefined) stale.add("render");
      // Lettering changes only need the text burned again
      if (body.style !== undefined) stale.add("render");
      if (body.include !== undefined && body.include !== block.include) {
        for (const s of block.kind === "sfx" ? (["clean_sfx", "render"] as const) : (["clean_text", "clean_sfx", "render"] as const)) stale.add(s);
      }
      // An empty style is the automatic layout: stored as none
      const style = body.style === undefined ? undefined : body.style && Object.keys(body.style).length > 0 ? body.style : null;
      const fields = { sourceText: body.source_text, translatedText: body.translated_text, include: body.include, style };
      if (!(await PageStore.updateBlock(params.id, params.idx, fields, [...stale]))) return status(404, { error: "block not found" });
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: t.Object({ id: IdParam, idx: t.Integer({ minimum: 1 }) }),
      body: t.Object({
        source_text: t.Optional(t.String({ maxLength: 2000 })),
        translated_text: t.Optional(t.String({ maxLength: 2000 })),
        /** Whether the clean pass removes this block's lettering. */
        include: t.Optional(t.Boolean()),
        /** Lettering overrides, replacing the stored ones; null or {} resets to automatic. */
        style: t.Optional(t.Nullable(StyleSchema)),
      }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .post(
    "/pages/:id/blocks",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const { kind, include, source_text, translated_text, style, ...geometry } = body;
      const invalid = geometryError(check.page, geometry);
      if (invalid) return status(422, { error: invalid });
      if (style?.box && (style.box.x + style.box.w > check.page.width || style.box.y + style.box.h > check.page.height)) {
        return status(422, { error: "text box extends outside the page" });
      }
      // Text and lettering style are stored in the same insert, so restoring a deleted region (undo) is one atomic request
      await PageStore.insertBlock(
        params.id, kind, geometry, include ?? true,
        { sourceText: source_text, translatedText: translated_text, style },
        stagesAffectedBy(kind),
      );
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: IdParams,
      body: t.Object({
        kind: t.UnionEnum(["text", "sfx"]),
        include: t.Optional(t.Boolean()),
        /** Restored with the region (e.g. undoing a delete). */
        source_text: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        translated_text: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        style: t.Optional(t.Nullable(StyleSchema)),
        ...GeometryBody,
      }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .put(
    "/pages/:id/blocks/:idx",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const invalid = geometryError(check.page, body);
      if (invalid) return status(422, { error: invalid });
      const block = (await PageStore.readJob(params.id))?.blocks.find((b) => b.id === params.idx);
      if (!block || !(await PageStore.updateBlockGeometry(params.id, params.idx, body, stagesAffectedBy(block.kind)))) {
        return status(404, { error: "block not found" });
      }
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: t.Object({ id: IdParam, idx: t.Integer({ minimum: 1 }) }),
      body: t.Object(GeometryBody),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .delete(
    "/pages/:id/blocks/:idx",
    ({ params, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const block = (await PageStore.readJob(params.id))?.blocks.find((b) => b.id === params.idx);
      // Its lettering is no longer cleaned or typeset; OCR / translate of the remaining blocks is unaffected
      // (the sound-effect pass is built on the text pass, so a text block outdates both)
      const stale: StageName[] = block?.kind === "sfx" ? ["clean_sfx", "render"] : ["clean_text", "clean_sfx", "render"];
      if (!block || !(await PageStore.deleteBlock(params.id, params.idx, stale))) return status(404, { error: "block not found" });
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: t.Object({ id: IdParam, idx: t.Integer({ minimum: 1 }) }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody },
    },
  )

  .post(
    "/pages/:id/run",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const stage: RunnableStage = body.stage;
      if (stage === "ocr" || stage === "translate") {
        const notReady = enginesNotReady();
        if (notReady) return status(503, { error: notReady });
      }
      // The sound-effect pass reads clean-text.png: running it on an outdated text pass would bake that image in
      if (stage === "clean_sfx") {
        const textPass = (await PageStore.listStages(params.id)).find((s) => s.stage === "clean_text");
        if (textPass && textPass.status !== "fresh") return status(409, { error: "Clean text first: the text pass is out of date" });
      }

      try {
        // The page lock keeps edits out while this reads, processes and writes the blocks; the global queue shares the CPU
        // Whether this run covered every block the stage applies to; a partial run can't vouch for the whole stage
        const wholeStage = await runExclusiveResult(async (): Promise<boolean> => {
          const pipeline = new PagePipeline(pageDir(params.id), () => {}, PageStore.repository(params.id));
          const job = await pipeline.readJob();
          if (!job) throw new Error("page has no detected blocks");
          const ids = body.block_ids;
          if (ids?.some((id) => !job.blocks.some((b) => b.id === id))) throw new Error("unknown block id");
          const covers = (targets: PageBlock[]): boolean => !ids || targets.every((b) => ids.includes(b.id));
          if (stage === "ocr") {
            const covered = covers(job.blocks.filter((b) => b.kind === "text"));
            await pipeline.ocr(job, pageEngines.ocr, ids);
            return covered;
          }
          if (stage === "translate") {
            const covered = covers(job.blocks.filter((b) => b.kind === "text" && b.source_text?.trim()));
            await pipeline.translate(job, pageEngines.translate, ids);
            return covered;
          }
          // Cleaning always covers the whole kind; to fix part of the page use POST …/reclean with areas
          if (stage === "clean_text" || stage === "clean_sfx") {
            await pipeline.clean(job, stage === "clean_text" ? "text" : "sfx");
            return true;
          }
          await pipeline.render(job);
          return true;
        });
        if (wholeStage) await PageStore.setStage(params.id, stage, "fresh");
        if (RUNNABLE[stage].length > 0) await PageStore.markStale(params.id, [...RUNNABLE[stage]]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, pageId: params.id, stage }, "Studio run failed");
        await PageStore.setStage(params.id, stage, "error", message).catch(() => {});
        return status(422, { error: message });
      }
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: IdParams,
      body: t.Object({
        stage: t.UnionEnum(["ocr", "translate", "clean_text", "clean_sfx", "render"]),
        /** Only these blocks (ocr / translate); cleaning and render always cover the whole page. */
        block_ids: t.Optional(t.Array(t.Integer({ minimum: 1 }), { minItems: 1, maxItems: 500 })),
      }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody, 503: ErrBody },
    },
  )

  .post(
    "/pages/:id/place",
    ({ params, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      try {
        await runExclusiveResult(async () => {
          const job = await PageStore.readJob(params.id);
          if (!job) throw new Error("page has no blocks yet");
          const pipeline = new PagePipeline(pageDir(params.id), () => {}, PageStore.repository(params.id));
          await pipeline.placeText(job);
        });
      } catch (err) {
        // Nothing to place on yet (e.g. not cleaned): the preview simply waits
        return status(409, { error: err instanceof Error ? err.message : String(err) });
      }
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    { params: IdParams, response: { 200: PageDetail, 404: ErrBody, 409: ErrBody } },
  )

  .put(
    "/pages/:id/mask/:layer",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const dir = pageDir(params.id);
      if (!existsSync(join(dir, "mask.png"))) return status(409, { error: "page has no detected text mask yet" });

      // Sizes come from the image headers first: a small compressed PNG can declare huge dimensions, so nothing is
      // decoded until the upload is known to match the detector mask's size
      const expected = await imageSize(join(dir, "mask.png"));
      let bytes: Buffer;
      let declared: { width: number; height: number };
      try {
        bytes = decodeBase64Image(body.image);
        if (bytes.byteLength > MAX_MASK_BYTES) return status(422, { error: "mask layer too large" });
        declared = await imageSize(bytes);
      } catch {
        return status(422, { error: "mask layer must be a valid image" });
      }
      if (declared.width !== expected.width || declared.height !== expected.height) {
        return status(422, { error: `mask layer must be ${expected.width}×${expected.height}, the page size` });
      }
      let decoded: Awaited<ReturnType<typeof maskFromImage>>;
      try {
        decoded = await maskFromImage(bytes);
      } catch {
        return status(422, { error: "mask layer must be a valid image" });
      }

      const file = join(dir, MASK_LAYER_FILES[params.layer]);
      // An empty layer is stored as no file, so an untouched page keeps using the detector mask as-is
      const png = decoded.mask.some((v) => v === 1) ? await maskToPng(decoded.mask, decoded.width, decoded.height) : null;
      // Stale first: if the write fails, the dependent stages are already flagged rather than wrongly fresh
      await PageStore.markStale(params.id, ["clean_text", "clean_sfx", "render"]);
      if (png) await Bun.write(file, png);
      else await rm(file, { force: true });
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: t.Object({ id: IdParam, layer: t.UnionEnum(["add", "erase"]) }),
      /** PNG (base64 or data URL) at page size: white (or any bright pixel) = painted. */
      body: t.Object({ image: t.String({ maxLength: Math.ceil(MAX_MASK_BYTES / 3) * 4 + 64 }) }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .delete(
    "/pages/:id/mask/:layer",
    ({ params, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const file = join(pageDir(params.id), MASK_LAYER_FILES[params.layer]);
      if (existsSync(file)) {
        await PageStore.markStale(params.id, ["clean_text", "clean_sfx", "render"]);
        await rm(file, { force: true });
      }
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: t.Object({ id: IdParam, layer: t.UnionEnum(["add", "erase"]) }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody },
    },
  )

  .post(
    "/pages/:id/reclean",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const { page } = check;
      if (body.areas.some((a) => a.x + a.w > page.width || a.y + a.h > page.height)) {
        return status(422, { error: "an area extends outside the page" });
      }
      try {
        // Only part of a clean pass runs, so the clean stages keep their status; the result needs typesetting again.
        // Marked before the cleaned image is rewritten, so a failure after the write can't leave render looking fresh.
        await PageStore.markStale(params.id, ["render"]);
        await runExclusiveResult(async () => {
          const pipeline = new PagePipeline(pageDir(params.id), () => {}, PageStore.repository(params.id));
          await pipeline.recleanAreas(body.areas);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, pageId: params.id }, "Studio re-clean failed");
        return status(422, { error: message });
      }
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: IdParams,
      body: t.Object({ areas: t.Array(AreaSchema, { minItems: 1, maxItems: 50 }) }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .post(
    "/pages/:id/rerun",
    async ({ params, body, status }) => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      // Runs the whole pipeline from the stored original: for imported pages, and after a detection change
      const result = await runStoredPage(params.id, {
        source: check.page.source,
        cleanSfx: body?.clean_sfx ?? check.page.cleanSfx,
        force: true,
      });
      if (!result.ok) return status(result.code === 404 ? 404 : result.code === 400 ? 422 : result.code, { error: result.error });
      return status(202, { job_id: result.job_id });
    },
    {
      params: IdParams,
      body: t.Optional(t.Object({ clean_sfx: t.Optional(t.Boolean()) })),
      response: { 202: t.Object({ job_id: t.String() }), 404: ErrBody, 409: ErrBody, 422: ErrBody, 429: ErrBody, 503: ErrBody },
    },
  )

  .post(
    "/pages/:id/publish",
    ({ params, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      if (!existsSync(join(pageDir(params.id), "result.png"))) return status(409, { error: "page has no result to publish" });
      // An edit saved after the last render would otherwise publish an image without it
      const stages = await PageStore.listStages(params.id);
      if (stages.some((s) => s.stage === "render" && s.status === "stale")) {
        return status(409, { error: "the page changed since it was last rendered — re-render before publishing" });
      }
      return publishPage(params.id);
    }),
    { params: IdParams, response: { 200: PublishResult, 404: ErrBody, 409: ErrBody } },
  )

  .get(
    "/pages/:id/history",
    async ({ params, status }) => {
      if (!(await PageStore.findById(params.id))) return status(404, { error: "page not found" });
      return listHistory(params.id);
    },
    {
      params: IdParams,
      response: { 200: t.Array(t.Object({ revision: t.Integer(), published_at: t.String() })), 404: ErrBody },
    },
  )

  .get(
    "/pages/:id/history/:revision",
    async ({ params, status, set }) => {
      const file = Bun.file(historyFile(params.id, params.revision));
      if (!(await file.exists())) return status(404, { error: "revision not found" });
      // A revision's snapshot never changes
      set.headers["Cache-Control"] = "private, max-age=31536000, immutable";
      return file;
    },
    { params: t.Object({ id: IdParam, revision: t.Integer({ minimum: 1 }) }) },
  )

  .post(
    "/pages/:id/rollback",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      if (!(await restoreResult(params.id, body.revision))) return status(404, { error: "revision not found" });
      // The restored image no longer matches the blocks: a later re-render would replace it with the current text.
      // Rollback publishes on purpose despite the stale render (the one exception to the publish check).
      await PageStore.markStale(params.id, ["render"]);
      return publishPage(params.id);
    }),
    {
      params: IdParams,
      body: t.Object({ revision: t.Integer({ minimum: 1 }) }),
      response: { 200: PublishResult, 404: ErrBody, 409: ErrBody },
    },
  );
