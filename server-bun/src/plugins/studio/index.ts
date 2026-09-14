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
 * PATCH /studio/api/pages/:id/blocks/:idx        edit source text / translation (marks later stages stale)
 * POST  /studio/api/pages/:id/run                re-run ocr / translate (all or some blocks) or render
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
import { ErrBody } from "@/lib/schemas";
import { runExclusiveResult, withPageLock } from "@/queue/page-queue";
import { fetchImage } from "@/services/image-fetch";
import { enginesNotReady, pageEngines } from "@/services/page-engines";
import { historyFile, listHistory, restoreResult, snapshotResult } from "@/services/page-history";
import { decodeBase64Image, resultUrl, submitPageJob } from "@/services/page-jobs";
import { PagePipeline, type BlockShape, type PageBlock } from "@/services/page-pipeline";
import { pageLive } from "@/stores/page-live-channel";
import { PAGE_JOBS_DIR, pageDir, PageStore, type StageName } from "@/stores/page-store";

const log = childLogger("studio");

/** Images a page folder may hold; anything else is refused. */
const PAGE_FILES = ["original.png", "overlay.png", "mask.png", "clean-text.png", "clean-sfx.png", "render-overlay.png", "result.png"] as const;

/** Stages the Studio can re-run, and the stages each run makes stale. */
const RUNNABLE = {
  ocr: ["translate", "render"],
  translate: ["render"],
  render: [],
} as const satisfies Record<string, readonly StageName[]>;
type RunnableStage = keyof typeof RUNNABLE;

const IdParam = t.String({ pattern: "^[A-Za-z0-9-]+$" });
const IdParams = t.Object({ id: IdParam });

const BoxSchema = t.Object({ x: t.Number(), y: t.Number(), w: t.Number(), h: t.Number() });

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
  kind === "sfx" ? ["clean_sfx", "render"] : ["ocr", "translate", "clean_text", "render"];

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
  };
}

function toStage(row: PageStageRow) {
  return { stage: row.stage, status: row.status, file: row.file, error: row.errorMessage, updated_at: row.updatedAt };
}

function toBlock(block: PageBlock) {
  return { ...block, render: block.render ?? null, shape: block.shape ?? null };
}

/** Everything the page editor shows, or null when the page doesn't exist. */
async function pageDetail(id: string) {
  const page = await PageStore.findById(id);
  if (!page) return null;
  const [stages, job] = await Promise.all([PageStore.listStages(id), PageStore.readJob(id)]);
  return { page: toSummary(page), stages: stages.map(toStage), blocks: (job?.blocks ?? []).map(toBlock) };
}

/** Why a page can't be edited right now (missing, or still running in the pipeline), as a status + message. */
async function editablePage(id: string): Promise<{ page: Page } | { code: 404 | 409; error: string }> {
  const page = await PageStore.findById(id);
  if (!page) return { code: 404, error: "page not found" };
  if (page.status === "queued" || page.status === "running") return { code: 409, error: "page is still being translated" };
  return { page };
}

/** Bumps the revision, snapshots result.png under it and tells open extension tabs. Call under the page lock. */
async function publish(id: string): Promise<{ revision: number; notified: number }> {
  const revision = await PageStore.bumpRevision(id);
  await snapshotResult(id, revision);
  const notified = pageLive.publish({ type: "page-updated", page_id: id, revision, result_url: resultUrl(id, revision) });
  log.info({ pageId: id, revision, notified }, "Page published");
  return { revision, notified };
}

export const studioPlugin = new Elysia({ prefix: "/studio/api" })
  .get("/pages", async () => (await PageStore.list()).map(toSummary), {
    response: { 200: t.Array(PageSummary) },
  })

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
    ({ params, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
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
    { params: IdParams, response: { 200: t.Object({ deleted: t.String() }), 404: ErrBody, 409: ErrBody } },
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
      if (body.source_text === undefined && body.translated_text === undefined) return status(422, { error: "nothing to update" });
      // A new source text makes its translation stale too; a new translation only needs typesetting again.
      // The edit and the stale marking commit together.
      const stale: StageName[] = body.source_text !== undefined ? ["translate", "render"] : ["render"];
      if (!(await PageStore.updateBlockText(params.id, params.idx, { sourceText: body.source_text, translatedText: body.translated_text }, stale))) {
        return status(404, { error: "block not found" });
      }
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    }),
    {
      params: t.Object({ id: IdParam, idx: t.Integer({ minimum: 1 }) }),
      body: t.Object({
        source_text: t.Optional(t.String({ maxLength: 2000 })),
        translated_text: t.Optional(t.String({ maxLength: 2000 })),
      }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody },
    },
  )

  .post(
    "/pages/:id/blocks",
    ({ params, body, status }) => withPageLock(params.id, async () => {
      const check = await editablePage(params.id);
      if ("code" in check) return status(check.code, { error: check.error });
      const { kind, include, source_text, translated_text, ...geometry } = body;
      const invalid = geometryError(check.page, geometry);
      if (invalid) return status(422, { error: invalid });
      // Text is stored in the same insert, so restoring a deleted region (undo) is a single atomic request
      await PageStore.insertBlock(params.id, kind, geometry, include ?? true, { sourceText: source_text, translatedText: translated_text }, stagesAffectedBy(kind));
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
      const stale: StageName[] = block?.kind === "sfx" ? ["clean_sfx", "render"] : ["clean_text", "render"];
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
      if (stage !== "render") {
        const notReady = enginesNotReady();
        if (notReady) return status(503, { error: notReady });
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
        stage: t.UnionEnum(["ocr", "translate", "render"]),
        /** Only these blocks (ocr / translate); render always typesets the whole page. */
        block_ids: t.Optional(t.Array(t.Integer({ minimum: 1 }), { minItems: 1, maxItems: 500 })),
      }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody, 503: ErrBody },
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
      return publish(params.id);
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
      return publish(params.id);
    }),
    {
      params: IdParams,
      body: t.Object({ revision: t.Integer({ minimum: 1 }) }),
      response: { 200: PublishResult, 404: ErrBody, 409: ErrBody },
    },
  );
