/**
 * Studio API: review and edit translated pages, then publish them to open extension tabs.
 *
 * GET   /studio/api/pages                        recent pages
 * POST  /studio/api/pages                        new page from an upload or image URL (progress: /api/translate-page/:id/events)
 * GET   /studio/api/pages/:id                    page, stage state and blocks
 * GET   /studio/api/pages/:id/files/:file        a stage image
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
import { join } from "node:path";
import type { Page, PageStageRow } from "@/db/schema";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import { runExclusiveResult, withPageLock } from "@/queue/page-queue";
import { fetchImage } from "@/services/image-fetch";
import { enginesNotReady, pageEngines } from "@/services/page-engines";
import { historyFile, listHistory, restoreResult, snapshotResult } from "@/services/page-history";
import { decodeBase64Image, resultUrl, submitPageJob } from "@/services/page-jobs";
import { PagePipeline, type PageBlock } from "@/services/page-pipeline";
import { pageLive } from "@/stores/page-live-channel";
import { pageDir, PageStore, type StageName } from "@/stores/page-store";

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
  return { ...block, render: block.render ?? null };
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
      if (!(await PageStore.updateBlockText(params.id, params.idx, { sourceText: body.source_text, translatedText: body.translated_text }))) {
        return status(404, { error: "block not found" });
      }
      // A new source text makes its translation stale too; a new translation only needs typesetting again
      await PageStore.markStale(params.id, body.source_text !== undefined ? ["translate", "render"] : ["render"]);
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
        await runExclusiveResult(async () => {
          const pipeline = new PagePipeline(pageDir(params.id), () => {}, PageStore.repository(params.id));
          const job = await pipeline.readJob();
          if (!job) throw new Error("page has no detected blocks");
          const ids = body.block_ids;
          if (ids?.some((id) => !job.blocks.some((b) => b.id === id))) throw new Error("unknown block id");
          if (stage === "ocr") await pipeline.ocr(job, pageEngines.ocr, ids);
          else if (stage === "translate") await pipeline.translate(job, pageEngines.translate, ids);
          else await pipeline.render(job);
        });
        await PageStore.setStage(params.id, stage, "fresh");
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
