/**
 * Studio API: review and edit translated pages, then publish them to open extension tabs.
 *
 * GET   /studio/api/pages                    recent pages
 * GET   /studio/api/pages/:id                page, stage state and blocks
 * GET   /studio/api/pages/:id/files/:file    a stage image
 * PATCH /studio/api/pages/:id/blocks/:idx    edit a translation (marks render stale)
 * POST  /studio/api/pages/:id/render         typeset the current translations again
 * POST  /studio/api/pages/:id/publish        push the result to extension tabs showing the page
 */
import Elysia, { t } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page, PageStageRow } from "@/db/schema";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import { runExclusiveResult } from "@/queue/page-queue";
import { PagePipeline, type PageBlock } from "@/services/page-pipeline";
import { pageLive } from "@/stores/page-live-channel";
import { pageDir, PageStore } from "@/stores/page-store";
import { resultUrl } from "@/plugins/route-translate-page";

const log = childLogger("studio");

/** Images a page folder may hold; anything else is refused. */
const PAGE_FILES = ["original.png", "overlay.png", "mask.png", "clean-text.png", "clean-sfx.png", "render-overlay.png", "result.png"] as const;

const IdParams = t.Object({ id: t.String({ pattern: "^[A-Za-z0-9-]+$" }) });

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

export const studioPlugin = new Elysia({ prefix: "/studio/api" })
  .get("/pages", async () => (await PageStore.list()).map(toSummary), {
    response: { 200: t.Array(PageSummary) },
  })

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
    { params: t.Object({ id: IdParams.properties.id, file: t.UnionEnum(PAGE_FILES) }) },
  )

  .patch(
    "/pages/:id/blocks/:idx",
    async ({ params, body, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      if (page.status === "queued" || page.status === "running") return status(409, { error: "page is still being translated" });
      if (!(await PageStore.updateTranslation(params.id, params.idx, body.translated_text))) return status(404, { error: "block not found" });
      await PageStore.markStale(params.id, ["render"]);
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    },
    {
      params: t.Object({ id: IdParams.properties.id, idx: t.Integer({ minimum: 1 }) }),
      body: t.Object({ translated_text: t.String({ maxLength: 2000 }) }),
      response: { 200: PageDetail, 404: ErrBody, 409: ErrBody },
    },
  )

  .post(
    "/pages/:id/render",
    async ({ params, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      if (page.status === "queued" || page.status === "running") return status(409, { error: "page is still being translated" });
      try {
        await runExclusiveResult(async () => {
          const pipeline = new PagePipeline(pageDir(params.id), () => {}, PageStore.repository(params.id));
          const job = await pipeline.readJob();
          if (!job) throw new Error("page has no detected blocks");
          await pipeline.render(job);
        });
        await PageStore.setStage(params.id, "render", "fresh");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, pageId: params.id }, "Studio render failed");
        await PageStore.setStage(params.id, "render", "error", message).catch(() => {});
        return status(422, { error: message });
      }
      return (await pageDetail(params.id)) ?? status(404, { error: "page not found" });
    },
    { params: IdParams, response: { 200: PageDetail, 404: ErrBody, 409: ErrBody, 422: ErrBody } },
  )

  .post(
    "/pages/:id/publish",
    async ({ params, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      if (!existsSync(join(pageDir(params.id), "result.png"))) return status(409, { error: "page has no result to publish" });
      const revision = await PageStore.bumpRevision(params.id);
      const notified = pageLive.publish({ type: "page-updated", page_id: params.id, revision, result_url: resultUrl(params.id, revision) });
      log.info({ pageId: params.id, revision, notified }, "Page published");
      return { revision, notified };
    },
    { params: IdParams, response: { 200: t.Object({ revision: t.Integer(), notified: t.Integer() }), 404: ErrBody, 409: ErrBody } },
  );
