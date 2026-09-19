/**
 * Studio workspaces: folders of pages worked on together. Mounted inside the Studio plugin, so under `/studio/api`.
 *
 * GET    /studio/api/workspaces               workspaces with page counts, newest first (`?source_url=`: earlier imports of a chapter)
 * POST   /studio/api/workspaces               a new, empty workspace
 * GET    /studio/api/workspaces/:id           a workspace and its pages in order
 * PATCH  /studio/api/workspaces/:id           rename it, or flip its adult flag
 * DELETE /studio/api/workspaces/:id           remove the workspace; its pages stay, loose
 * POST   /studio/api/workspaces/:id/pages     append uploaded images at `start_index` (a retried batch skips pages it already stored)
 */
import Elysia, { t } from "elysia";
import type { Workspace } from "@/db/schema";
import { ErrBody } from "@/lib/schemas";
import { authContext } from "@/plugins/auth/index";
import { PageSummary, toSummary } from "@/plugins/studio/page-summary";
import { importIntoWorkspace, type WorkspaceUpload } from "@/services/workspace-import";
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
  created_at: t.String(),
  updated_at: t.String(),
  pages: t.Integer(),
  done: t.Integer(),
  idle: t.Integer(),
  stale: t.Integer(),
  error: t.Integer(),
  running: t.Integer(),
  first_page_id: t.Nullable(t.String()),
});

const WorkspaceDetail = t.Object({ workspace: WorkspaceSummary, pages: t.Array(PageSummary) });

const Skipped = t.Object({ name: t.String(), index: t.Integer(), reason: t.String() });

/** A workspace name: trimmed, and not blank. */
const Name = t.String({ minLength: 1, maxLength: 200 });

function toWorkspace(workspace: Workspace, counts: WorkspaceCounts | undefined) {
  const c = counts ?? { pages: 0, done: 0, idle: 0, stale: 0, error: 0, running: 0, firstPageId: null };
  return {
    id: workspace.id,
    name: workspace.name,
    chapter_id: workspace.chapterId,
    created_by: workspace.createdBy,
    source_url: workspace.sourceUrl,
    source_provider: workspace.sourceProvider,
    adult: workspace.adult,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
    pages: c.pages,
    done: c.done,
    idle: c.idle,
    stale: c.stale,
    error: c.error,
    running: c.running,
    first_page_id: c.firstPageId,
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
    async ({ params, status }) => {
      // The pages aren't touched: the foreign key leaves them loose in the Studio
      if (!(await WorkspaceStore.delete(params.id))) return status(404, { error: "workspace not found" });
      return { deleted: params.id };
    },
    { params: WorkspaceParams, response: { 200: t.Object({ deleted: t.Integer() }), 404: ErrBody } },
  )

  .post(
    "/:id/pages",
    async ({ params, body, status }) => {
      if (!(await WorkspaceStore.findById(params.id))) return status(404, { error: "workspace not found" });
      const files = Array.isArray(body.files) ? body.files : [body.files];
      const sources = body.sources ?? [];
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
        sources: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 4096 }), { maxItems: 500 })),
      }),
      response: {
        200: t.Composite([WorkspaceDetail, t.Object({ imported: t.Integer(), existing: t.Array(t.Integer()), skipped: t.Array(Skipped) })]),
        404: ErrBody,
        422: ErrBody,
      },
    },
  );
