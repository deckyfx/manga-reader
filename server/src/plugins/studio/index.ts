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
 * Workspaces live in ./workspaces.ts.
 *
 * Mutations of one page (edit, run, publish, rollback) run under a per-page lock so their steps never interleave.
 */
import Elysia, { t } from "elysia";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page, PageStageRow } from "@/db/schema";
import { childLogger } from "@/lib/logger";
import { ErrBody, optionalEnum } from "@/lib/schemas";
import { runExclusiveResult, withPageLock } from "@/queue/page-queue";
import { fetchImage } from "@/services/image-fetch";
import { enginesNotReady, pageEngines } from "@/services/page-engines";
import { historyFile, listHistory, restoreResult } from "@/services/page-history";
import { finalizePage, planFinalize } from "@/services/page-finalize";
import { pageLocation, pageLocations } from "@/services/page-location";
import { publishBlocker, publishDraft } from "@/services/draft-publish";
import { discardPage } from "@/services/page-discard";
import { publishPage } from "@/services/page-publish";
import { decodeBase64Image, runStoredPage, submitPageJob } from "@/services/page-jobs";
import { MASK_LAYER_FILES, PagePipeline, type BlockShape, type PageBlock } from "@/services/page-pipeline";
import { FONT_FILES } from "@/services/typeset-service";
import { FONT_VARIANTS, TEXT_ALIGNS, type TextStyle } from "@/shared/typeset";
import { imageSize, maskFromImage, maskToPng } from "@/lib/mask";
import { pageDir, PageStore, type StageName } from "@/stores/page-store";
import { PageSummary, toSummary } from "@/plugins/studio/page-summary";
import { workspacesPlugin } from "@/plugins/studio/workspaces";

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

/** Two lettering styles are the same whatever order their keys were written in (null = automatic). */
function sameStyle(a: TextStyle | null, b: TextStyle | null): boolean {
  const canonical = (value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, canonical(v)]))
      : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

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
  /**
   * The self-check from the last clean: how this block was cleaned ("flat" fill or "lama"), and how much of its
   * lettering still shows (0–1). Null for a block that hasn't been cleaned.
   */
  clean: t.Nullable(t.Object({ method: t.String(), ink: t.Number() })),
  /** Its source text changed since it was last translated. */
  needs_translate: t.Boolean(),
  /** It changed since the page was last rendered: this block is why the render is out of date. */
  needs_render: t.Boolean(),
});

const PageDetail = t.Object({ page: PageSummary, stages: t.Array(StageSchema), blocks: t.Array(BlockSchema) });

const PublishResult = t.Object({ revision: t.Integer(), notified: t.Integer() });

const FinalizeResult = t.Object({
  pages: t.Array(t.Object({
    id: t.String(),
    ok: t.Boolean(),
    /** Why this page was left as it was; null when it was (or, on a dry run, would be) finalized. */
    reason: t.Nullable(t.String()),
    /** What was (or would be) deleted, relative to the page's folder. */
    files: t.Array(t.String()),
    bytes: t.Integer(),
  })),
  /** Space freed (or that would be) across all of them. */
  bytes: t.Integer(),
});

function toStage(row: PageStageRow) {
  return { stage: row.stage, status: row.status, file: row.file, error: row.errorMessage, updated_at: row.updatedAt };
}

function toBlock(block: PageBlock) {
  return {
    ...block,
    render: block.render ?? null,
    shape: block.shape ?? null,
    style: block.style ?? null,
    area: block.area ?? null,
    clean: block.clean ?? null,
    needs_translate: block.needs_translate ?? false,
    needs_render: block.needs_render ?? false,
  };
}

/** Everything the page editor shows, or null when the page doesn't exist. */
async function pageDetail(id: string) {
  const page = await PageStore.findById(id);
  if (!page) return null;
  const [stages, job, location] = await Promise.all([PageStore.listStages(id), PageStore.readJob(id), pageLocation(page)]);
  return { page: { ...toSummary(page), location }, stages: stages.map(toStage), blocks: (job?.blocks ?? []).map(toBlock) };
}

/** Why a page can't be edited right now (missing, or still running in the pipeline), as a status + message. */
/**
 * The page, if it can be worked on now. A finalized page can't — its working state is gone — except that one which
 * kept its original may be redone (`redo`), which runs every stage again from that original.
 */
async function editablePage(id: string, { redo = false } = {}): Promise<{ page: Page } | { code: 404 | 409; error: string }> {
  const page = await PageStore.findById(id);
  if (!page) return { code: 404, error: "page not found" };
  if (page.status === "queued" || page.status === "running") return { code: 409, error: "page is still being translated" };
  if (page.finalizedAt !== null) {
    if (page.rawDeleted) return { code: 409, error: "this page is finalized without its original, so it can't be changed" };
    if (!redo) return { code: 409, error: "this page is finalized — redo it to work on it again" };
  }
  return { page };
}

export const studioPlugin = new Elysia({ prefix: "/studio/api" })
  .use(workspacesPlugin)

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
      const discarded = await discardPage(params.id);
      if (!discarded.ok) return status(409, { error: discarded.error });
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
      // Only what actually changes: saving a field back unchanged (a blur on an untouched box, a re-save of the same
      // style) leaves the stages as they were, instead of asking for a re-render that would produce the same image
      const stale = new Set<StageName>();
      if (body.source_text !== undefined && body.source_text !== (block.source_text ?? "")) stale.add("translate").add("render");
      if (body.translated_text !== undefined && body.translated_text !== (block.translated_text ?? "")) stale.add("render");
      // An empty style is the automatic layout: stored as none
      const style = body.style === undefined ? undefined : body.style && Object.keys(body.style).length > 0 ? body.style : null;
      // Lettering changes only need the text burned again
      if (style !== undefined && !sameStyle(style, block.style ?? null)) stale.add("render");
      if (body.include !== undefined && body.include !== block.include) {
        for (const s of block.kind === "sfx" ? (["clean_sfx", "render"] as const) : (["clean_text", "clean_sfx", "render"] as const)) stale.add(s);
      }
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
        // …and whether it changed any text: a re-read or re-translation that comes back the same leaves the stages
        // after it as they were, rather than asking for work that would produce the same result
        const { wholeStage, changed } = await runExclusiveResult(async (): Promise<{ wholeStage: boolean; changed: boolean }> => {
          const pipeline = new PagePipeline(pageDir(params.id), () => {}, PageStore.repository(params.id));
          const job = await pipeline.readJob();
          if (!job) throw new Error("page has no detected blocks");
          const ids = body.block_ids;
          if (ids?.some((id) => !job.blocks.some((b) => b.id === id))) throw new Error("unknown block id");
          const covers = (targets: PageBlock[]): boolean => !ids || targets.every((b) => ids.includes(b.id));
          const texts = (field: "source_text" | "translated_text"): string => JSON.stringify(job.blocks.map((b) => [b.id, b[field] ?? ""]));
          if (stage === "ocr") {
            const covered = covers(job.blocks.filter((b) => b.kind === "text"));
            const before = texts("source_text");
            await pipeline.ocr(job, pageEngines.ocr, ids);
            return { wholeStage: covered, changed: texts("source_text") !== before };
          }
          if (stage === "translate") {
            const covered = covers(job.blocks.filter((b) => b.kind === "text" && b.source_text?.trim()));
            const before = texts("translated_text");
            await pipeline.translate(job, pageEngines, ids);
            return { wholeStage: covered, changed: texts("translated_text") !== before };
          }
          // Cleaning always covers the whole kind; to fix part of the page use POST …/reclean with areas. A new image
          // is always a change for what's built on it
          if (stage === "clean_text" || stage === "clean_sfx") {
            await pipeline.clean(job, stage === "clean_text" ? "text" : "sfx");
            return { wholeStage: true, changed: true };
          }
          await pipeline.render(job);
          return { wholeStage: true, changed: true };
        }, `page ${params.id} ${stage}`);
        if (wholeStage) await PageStore.setStage(params.id, stage, "fresh");
        if (changed && RUNNABLE[stage].length > 0) await PageStore.markStale(params.id, [...RUNNABLE[stage]]);
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
        }, `page ${params.id} place`);
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
          // The blocks' self-check was measured before this fix: measure it again on the page as it is now
          const job = await pipeline.readJob();
          if (job) {
            await pipeline.refreshCleanCheck(job);
            await pipeline.writeJob(job);
          }
        }, `page ${params.id} re-clean`);
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
    "/pages/finalize",
    async ({ body }) => {
      const deleteRaw = body.delete_raw ?? false;
      const pages: { id: string; ok: boolean; reason: string | null; files: string[]; bytes: number }[] = [];
      // One page at a time, each under its own lock, read fresh there: a page may have been edited, run or finalized
      // since the list was shown
      for (const id of [...new Set(body.ids)]) {
        const plan = await withPageLock(id, async () => {
          const page = await PageStore.findById(id);
          if (!page) return { ok: false as const, reason: "page not found" };
          return body.dry_run ? planFinalize(page, deleteRaw) : finalizePage(page, deleteRaw);
        });
        pages.push(plan.ok ? { id, ok: true, reason: null, files: plan.files, bytes: plan.bytes } : { id, ok: false, reason: plan.reason, files: [], bytes: 0 });
      }
      return { pages, bytes: pages.reduce((sum, page) => sum + page.bytes, 0) };
    },
    {
      body: t.Object({
        ids: t.Array(IdParam, { minItems: 1, maxItems: 200 }),
        /** Delete the original too: the page becomes read-only for good, and the image is no longer recognised. */
        delete_raw: t.Optional(t.Boolean()),
        /** Report what would be deleted and the space freed, changing nothing. */
        dry_run: t.Optional(t.Boolean()),
      }),
      response: { 200: FinalizeResult },
    },
  )

  .post(
    "/pages/:id/rerun",
    async ({ params, body, status }) => {
      // Admission under the page's lock: it marks the page queued, and a publish holding the lock must finish
      // deciding on the page it read before that happens. The run itself queues behind, outside this lock.
      const check = await withPageLock(params.id, async () => {
        // Running again is also how a finalized page (original kept) is redone
        const editable = await editablePage(params.id, { redo: true });
        if ("code" in editable) return editable;
        const result = await runStoredPage(params.id, {
          source: editable.page.source,
          cleanSfx: body?.clean_sfx ?? editable.page.cleanSfx,
          force: true,
        });
        // Only once the run is really under way: a refused start leaves the page finalized as it was
        if (result.ok && editable.page.finalizedAt !== null) await PageStore.clearFinalized(params.id);
        return { ...editable, result };
      });
      if ("code" in check) return status(check.code, { error: check.error });
      const { result } = check;
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
      const blocker = publishBlocker(check.page, await PageStore.listStages(params.id));
      if (blocker) return status(409, { error: blocker });
      // A draft of a chapter page publishes over that page instead of itself
      const outcome = await publishDraft(check.page);
      if (!outcome.ok) return status(outcome.code, { error: outcome.error });
      return { revision: outcome.revision, notified: outcome.notified };
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
      await PageStore.noteResultChanged(params.id);
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
