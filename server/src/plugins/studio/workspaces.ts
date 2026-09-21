/**
 * Studio workspaces: folders of pages worked on together. Mounted inside the Studio plugin, so under `/studio/api`.
 *
 * GET    /studio/api/workspaces               workspaces with page counts, newest first (`?source_url=`: earlier imports of a chapter)
 * POST   /studio/api/workspaces               a new, empty workspace
 * GET    /studio/api/workspaces/:id           a workspace and its pages in order
 * PATCH  /studio/api/workspaces/:id           rename it, or flip its adult flag
 * DELETE /studio/api/workspaces/:id           remove the workspace; its pages stay, loose
 * POST   /studio/api/workspaces/:id/pages     append uploaded images at `start_index` (a retried batch skips pages it already stored)
 * POST   /studio/api/workspaces/:id/file      move its pages into a chapter, publishing the translated ones
 * POST   /studio/api/workspaces/:id/publish   publish every page holding work readers can't see yet
 * POST   /studio/api/workspaces/:id/run       translate the pages that need it ("Run all"); progress is polled
 * GET    /studio/api/workspaces/:id/run       progress of that run, or how many pages one would translate now
 */
import Elysia, { t } from "elysia";
import type { Workspace } from "@/db/schema";
import { ErrBody } from "@/lib/schemas";
import { authContext } from "@/plugins/auth/index";
import { PageSummary, toSummary } from "@/plugins/studio/page-summary";
import { publishBlocker, publishDraft } from "@/services/draft-publish";
import { batchRun, pagesNeedingRun, startBatchRun } from "@/services/page-batch";
import { discardPage } from "@/services/page-discard";
import { fileWorkspaceIntoChapter } from "@/services/workspace-file";
import { importIntoWorkspace, type WorkspaceUpload } from "@/services/workspace-import";
import { importUrlsIntoWorkspace, MAX_URLS_PER_IMPORT, tidyUrls } from "@/services/url-import";
import { withPageLock, withWorkspaceLock } from "@/queue/page-queue";
import { ChapterStore, normaliseTags } from "@/stores/library-store";
import { PageStore } from "@/stores/page-store";
import { WorkspaceStore, type WorkspaceCounts } from "@/stores/workspace-store";

const WorkspaceParams = t.Object({ id: t.Integer({ minimum: 1 }) });

const WorkspaceSummary = t.Object({
  id: t.Integer(),
  name: t.String(),
  /** The chapter it works on (sent to the Studio, or filed into); null for a plain import. */
  chapter_id: t.Nullable(t.Integer()),
  created_by: t.Nullable(t.Integer()),
  source_url: t.Nullable(t.String()),
  source_provider: t.Nullable(t.String()),
  adult: t.Boolean(),
  /** The site's tags for what was imported, suggested when a series is made from this workspace. */
  tags: t.Array(t.String()),
  created_at: t.String(),
  updated_at: t.String(),
  pages: t.Integer(),
  done: t.Integer(),
  idle: t.Integer(),
  stale: t.Integer(),
  error: t.Integer(),
  running: t.Integer(),
  first_page_id: t.Nullable(t.String()),
  /** Where the next upload batch should start, so a batch lands after every page already here. */
  next_index: t.Integer(),
});

const WorkspaceDetail = t.Object({ workspace: WorkspaceSummary, pages: t.Array(PageSummary) });

const WorkspaceRun = t.Object({
  workspaceId: t.Integer(),
  running: t.Boolean(),
  total: t.Integer(),
  done: t.Integer(),
  failed: t.Integer(),
  currentPageId: t.Nullable(t.String()),
  startedAt: t.String(),
  finishedAt: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
});

const Skipped = t.Object({ name: t.String(), index: t.Integer(), reason: t.String() });

/** The same, from an address import: it also says which address failed. */
const SkippedUrl = t.Object({ url: t.Nullable(t.String()), name: t.String(), index: t.Integer(), reason: t.String() });

/** One run per workspace at a time. */
const runKey = (id: number): string => `workspace:${id}`;

/** The workspace's pages a run would translate now. */
const pagesToRun = async (id: number, force: boolean) => pagesNeedingRun(await WorkspaceStore.pages(id), force);

/** Stored tags, read back. A value that isn't a list of strings (hand-edited, say) reads as none rather than failing. */
function parseTags(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

/** A workspace name: trimmed, and not blank. */
const Name = t.String({ minLength: 1, maxLength: 200 });

function toWorkspace(workspace: Workspace, counts: WorkspaceCounts | undefined) {
  const c = counts ?? { pages: 0, done: 0, idle: 0, stale: 0, error: 0, running: 0, firstPageId: null, nextIndex: 0 };
  return {
    id: workspace.id,
    name: workspace.name,
    chapter_id: workspace.chapterId,
    created_by: workspace.createdBy,
    source_url: workspace.sourceUrl,
    source_provider: workspace.sourceProvider,
    adult: workspace.adult,
    tags: parseTags(workspace.tagsJson),
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
    pages: c.pages,
    done: c.done,
    idle: c.idle,
    stale: c.stale,
    error: c.error,
    running: c.running,
    first_page_id: c.firstPageId,
    next_index: c.nextIndex,
  };
}

/** A workspace with its pages in order, or null when it doesn't exist. */
async function workspaceDetail(id: number) {
  const workspace = await WorkspaceStore.findById(id);
  if (!workspace) return null;
  const [pages, counts] = await Promise.all([WorkspaceStore.pages(id), WorkspaceStore.countsFor([id])]);
  return { workspace: toWorkspace(workspace, counts.get(id)), pages: pages.map((page) => ({ ...toSummary(page), location: null })) };
}

export const workspacesPlugin = new Elysia({ prefix: "/workspaces" })
  // For `principal`; the guard in plugins/auth/guard.ts enforces the role
  .use(authContext)

  .get(
    "/",
    async ({ query }) => {
      const list = await WorkspaceStore.list(query.source_url !== undefined ? { sourceUrl: query.source_url } : {});
      const counts = await WorkspaceStore.countsFor(list.map((workspace) => workspace.id));
      return list.map((workspace) => toWorkspace(workspace, counts.get(workspace.id)));
    },
    {
      query: t.Object({ source_url: t.Optional(t.String({ maxLength: 4096 })) }),
      response: { 200: t.Array(WorkspaceSummary) },
    },
  )

  .post(
    "/",
    async ({ body, principal, status }) => {
      const name = body.name.trim();
      if (!name) return status(422, { error: "give the workspace a name" });
      const workspace = await WorkspaceStore.create({
        name,
        createdBy: principal?.user.id ?? null,
        sourceUrl: body.source_url ?? null,
        sourceProvider: body.source_provider ?? null,
        adult: body.adult ?? false,
        tagsJson: JSON.stringify(normaliseTags(body.tags ?? [])),
      });
      return status(201, toWorkspace(workspace, undefined));
    },
    {
      body: t.Object({
        name: Name,
        /** The page the images came from, so importing it again can offer this workspace. */
        source_url: t.Optional(t.String({ maxLength: 4096 })),
        source_provider: t.Optional(t.String({ maxLength: 64 })),
        adult: t.Optional(t.Boolean()),
        /** The site's own tags, kept as suggestions for a series made from this workspace later. */
        tags: t.Optional(t.Array(t.String({ maxLength: 80 }), { maxItems: 100 })),
      }),
      response: { 201: WorkspaceSummary, 422: ErrBody },
    },
  )

  .get(
    "/:id",
    async ({ params, status }) => (await workspaceDetail(params.id)) ?? status(404, { error: "workspace not found" }),
    { params: WorkspaceParams, response: { 200: WorkspaceDetail, 404: ErrBody } },
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const name = body.name?.trim();
      if (name === "") return status(422, { error: "give the workspace a name" });
      const updated = await WorkspaceStore.update(params.id, {
        ...(name !== undefined ? { name } : {}),
        ...(body.adult !== undefined ? { adult: body.adult } : {}),
      });
      if (!updated) return status(404, { error: "workspace not found" });
      return (await workspaceDetail(params.id)) ?? status(404, { error: "workspace not found" });
    },
    {
      params: WorkspaceParams,
      body: t.Object({ name: t.Optional(Name), adult: t.Optional(t.Boolean()) }),
      response: { 200: WorkspaceDetail, 404: ErrBody, 422: ErrBody },
    },
  )

  .delete(
    "/:id",
    async ({ params, query, status }) => {
      // Under the lock, where a run can neither be going nor start: closing a workspace mid-run would leave the run
      // translating pages that no longer belong to anything
      const outcome = await withWorkspaceLock(params.id, async () => {
        if (batchRun(runKey(params.id))?.running) return "running" as const;
        if (!(await WorkspaceStore.findById(params.id))) return "missing" as const;

        let pagesDeleted = 0;
        let pagesKept = 0;
        if (!query.keep_pages) {
          const pages = await WorkspaceStore.pages(params.id);
          // A page still in the pipeline can't go: refuse the whole close rather than leave half a workspace behind
          if (pages.some((page) => page.status === "queued" || page.status === "running")) return "busy" as const;
          for (const page of pages) {
            // A page filed into a chapter is one readers are served: closing the workspace detaches it, never deletes
            // it. Loose pages and drafts belong to the workspace alone, and go with it.
            if (page.chapterId !== null) {
              pagesKept++;
              continue;
            }
            const discarded = await withPageLock(page.id, () => discardPage(page.id));
            if (discarded.ok) pagesDeleted++;
          }
        }
        // Whatever is left falls back to loose (the foreign key clears it): kept pages, or everything with keep_pages
        await WorkspaceStore.delete(params.id);
        return { pagesDeleted, pagesKept };
      });
      if (outcome === "running") return status(409, { error: "this workspace is being translated — wait for the run to finish" });
      if (outcome === "busy") return status(409, { error: "a page is still being translated — wait for it, or keep the pages" });
      if (outcome === "missing") return status(404, { error: "workspace not found" });
      return { deleted: params.id, pages_deleted: outcome.pagesDeleted, pages_kept: outcome.pagesKept };
    },
    {
      params: WorkspaceParams,
      /** Keep the workspace's pages as loose drafts instead of deleting them with it. */
      query: t.Object({ keep_pages: t.Optional(t.Boolean()) }),
      response: {
        200: t.Object({ deleted: t.Integer(), pages_deleted: t.Integer(), pages_kept: t.Integer() }),
        404: ErrBody,
        409: ErrBody,
      },
    },
  )

  .post(
    "/:id/pages",
    async ({ params, body, status }) => {
      if (!(await WorkspaceStore.findById(params.id))) return status(404, { error: "workspace not found" });
      const files = Array.isArray(body.files) ? body.files : [body.files];
      // One file's worth of sources arrives as a plain string: form data can't tell a one-item list from a value
      const sources = body.sources === undefined ? [] : Array.isArray(body.sources) ? body.sources : [body.sources];
      if (body.sources !== undefined && sources.length !== files.length) return status(422, { error: "sources must list one URL per file" });
      const uploads: WorkspaceUpload[] = [];
      for (const [i, file] of files.entries()) {
        const source = sources[i];
        uploads.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), ...(source !== undefined ? { source } : {}) });
      }
      const report = await importIntoWorkspace(params.id, body.start_index, uploads);
      const detail = await workspaceDetail(params.id);
      if (!detail) return status(404, { error: "workspace not found" });
      return { ...detail, imported: report.pages.length, existing: report.existing, skipped: report.skipped };
    },
    {
      params: WorkspaceParams,
      body: t.Object({
        files: t.Files(),
        /** 0-based position of the first file in the workspace. */
        start_index: t.Numeric({ minimum: 0, maximum: 100_000 }),
        /** Each file's source URL, in the same order (a JSON array in the form field). */
        // A list, or — when a batch holds a single file, as a page-at-a-time import always does — one plain string
        sources: t.Optional(t.Union([
          t.Array(t.String({ minLength: 1, maxLength: 4096 }), { maxItems: 500 }),
          t.String({ minLength: 1, maxLength: 4096 }),
        ])),
      }),
      response: {
        200: t.Composite([WorkspaceDetail, t.Object({ imported: t.Integer(), existing: t.Array(t.Integer()), skipped: t.Array(Skipped) })]),
        404: ErrBody,
        422: ErrBody,
      },
    },
    )

  .post(
    "/:id/pages/urls",
    async ({ params, body, status }) => {
      if (!(await WorkspaceStore.findById(params.id))) return status(404, { error: "workspace not found" });
      const urls = tidyUrls(body.urls);
      if (urls.length === 0) return status(422, { error: "give at least one image address" });
      const report = await importUrlsIntoWorkspace(params.id, body.start_index, urls);
      const detail = await workspaceDetail(params.id);
      if (!detail) return status(404, { error: "workspace not found" });
      return { ...detail, imported: report.pages.length, existing: report.existing, skipped: report.skipped };
    },
    {
      params: WorkspaceParams,
      body: t.Object({
        urls: t.Array(t.String({ minLength: 1, maxLength: 4096 }), { maxItems: MAX_URLS_PER_IMPORT }),
        /** 0-based position of the first address in the workspace, as for uploaded files. */
        start_index: t.Integer({ minimum: 0, maximum: 100_000 }),
      }),
      response: {
        200: t.Composite([WorkspaceDetail, t.Object({ imported: t.Integer(), existing: t.Array(t.Integer()), skipped: t.Array(SkippedUrl) })]),
        404: ErrBody,
        422: ErrBody,
      },
    },
  )

  .post(
    "/:id/run",
    async ({ params, body, status }) => {
      // Everything decided under the workspace's lock: filing and closing hold it too, so a run can't start on top
      // of either, nor for a workspace that has just gone. Drafts aren't published by a run — that happens when they
      // are filed, or published on purpose.
      const started = await withWorkspaceLock(params.id, async () => {
        if (!(await WorkspaceStore.findById(params.id))) return "missing" as const;
        return startBatchRun(runKey(params.id), () => pagesToRun(params.id, body?.force ?? false), {
          cleanSfx: body?.clean_sfx ?? false,
          publish: false,
          // An import uploads a page at a time while this run is translating: keep picking up new ones as they land
          follow: true,
        });
      });
      if (started === "missing") return status(404, { error: "workspace not found" });
      const state = started;
      if (!state) return status(409, { error: "this workspace is already being translated" });
      return status(202, { ...state, workspaceId: params.id });
    },
    {
      params: WorkspaceParams,
      body: t.Optional(t.Object({ force: t.Optional(t.Boolean()), clean_sfx: t.Optional(t.Boolean()) })),
      response: { 202: WorkspaceRun, 404: ErrBody, 409: ErrBody },
    },
  )

  .get(
    "/:id/run",
    async ({ params, status }) => {
      if (!(await WorkspaceStore.findById(params.id))) return status(404, { error: "workspace not found" });
      const state = batchRun(runKey(params.id));
      // No run yet: report what one would do now, so the button can show the count
      if (state) return { ...state, workspaceId: params.id };
      return { workspace_id: params.id, pending: (await pagesToRun(params.id, false)).length };
    },
    {
      params: WorkspaceParams,
      response: { 200: t.Union([WorkspaceRun, t.Object({ workspace_id: t.Integer(), pending: t.Integer() })]), 404: ErrBody },
    },
    )

  .post(
    "/:id/file",
    async ({ params, body, status }) => {
      const workspace = await WorkspaceStore.findById(params.id);
      if (!workspace) return status(404, { error: "workspace not found" });
      // Already working on a chapter: its pages belong there (filed, or drafts of it), so filing again would move
      // them out from under it
      if (workspace.chapterId !== null) {
        return status(409, { error: "this workspace already works on a chapter" });
      }
      if (!(await ChapterStore.findById(body.chapter_id))) return status(404, { error: "chapter not found" });
      const result = await fileWorkspaceIntoChapter(params.id, body.chapter_id);
      if (!result.ok) return status(409, { error: result.error });
      const detail = await workspaceDetail(params.id);
      if (!detail) return status(404, { error: "workspace not found" });
      return { ...detail, ...result.report };
    },
    {
      params: WorkspaceParams,
      body: t.Object({ chapter_id: t.Integer({ minimum: 1 }) }),
      response: {
        200: t.Composite([WorkspaceDetail, t.Object({
          filed: t.Integer(),
          published: t.Integer(),
          skipped: t.Array(t.Object({ pageId: t.String(), reason: t.String() })),
        })]),
        404: ErrBody,
        409: ErrBody,
      },
    },
    )

  .post(
    "/:id/publish",
    async ({ params, status }) => {
      // The whole run holds the workspace's lock, in the order filing takes them too (workspace, then page, then the
      // origin a draft publishes over), so closing the workspace can't detach pages halfway through publishing them
      const result = await withWorkspaceLock(params.id, async () => {
        const workspace = await WorkspaceStore.findById(params.id);
        if (!workspace) return null;
        // Publishing a workspace means putting its pages in front of readers, which only a chapter does: an import
        // not yet filed has no chapter, so there is nowhere for them to go
        if (workspace.chapterId === null) return "unbound" as const;
        // A run works outside this lock once it has started, and replaces results as it goes: publishing now would
        // hand readers a page the run is about to redo
        if (batchRun(runKey(params.id))?.running) return "running" as const;
        const pages = await WorkspaceStore.pages(params.id);
        let published = 0;
        const skipped: { pageId: string; reason: string }[] = [];
        for (const page of pages) {
          // Every page is decided under its own lock: an edit finishing between this listing and the lock would
          // otherwise be skipped, and publishing all of them is exactly what was asked for
          const outcome = await withPageLock(page.id, async () => {
            // Re-read inside the lock: an edit landing since the list was taken changes both of these answers
            const current = await PageStore.findById(page.id);
            if (!current) return { ok: false as const, code: 404 as const, error: "the page is gone" };
            if (!toSummary(current).has_edits) return { ok: false as const, code: 409 as const, error: "nothing new to publish" };
            const blocker = publishBlocker(current, await PageStore.listStages(current.id));
            if (blocker) return { ok: false as const, code: 409 as const, error: blocker };
            return publishDraft(current);
          });
          if (outcome.ok) published++;
          // Something that changed under us is not worth reporting as a failure; a real blocker is
          else if (outcome.error !== "nothing new to publish") skipped.push({ pageId: page.id, reason: outcome.error });
        }
        // Read inside the lock as well: a close queued behind this run would otherwise turn a finished publish
        // into a 404
        const detail = await workspaceDetail(params.id);
        return detail ? { ...detail, published, skipped } : null;
      });
      if (!result) return status(404, { error: "workspace not found" });
      if (result === "running") return status(409, { error: "this workspace is being translated — wait for the run to finish" });
      if (result === "unbound") return status(409, { error: "file this workspace into a chapter before publishing it" });
      return result;
    },
    {
      params: WorkspaceParams,
      response: {
        200: t.Composite([WorkspaceDetail, t.Object({
          published: t.Integer(),
          skipped: t.Array(t.Object({ pageId: t.String(), reason: t.String() })),
        })]),
        404: ErrBody,
        409: ErrBody,
      },
    },
  );
