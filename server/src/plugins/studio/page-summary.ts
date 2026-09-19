/**
 * The page summary every Studio list shows (the page list, a workspace's pages), shared by the Studio plugins.
 */
import { t } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@/db/schema";
import { hasUnpublishedEdits, publishedFile } from "@/services/page-history";
import { pageDir } from "@/stores/page-store";

export const PageLocationSchema = t.Object({
  series_id: t.Integer(),
  series_title: t.String(),
  chapter_id: t.Integer(),
  chapter_title: t.String(),
  chapter_number: t.Nullable(t.String()),
  index: t.Integer(),
  total: t.Integer(),
});

export const PageSummary = t.Object({
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
  /** Studio workspace the page is in; null = loose. */
  workspace_id: t.Nullable(t.Integer()),
  /** For a draft copy of a chapter page: the page it replaces when published. */
  origin_page_id: t.Nullable(t.String()),
  /** Series, chapter and reading position, for pages filed into a chapter. */
  location: t.Optional(t.Nullable(PageLocationSchema)),
});

/** A page row as the Studio lists it (without its location, which callers look up in bulk). */
export function toSummary(page: Page) {
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
    workspace_id: page.workspaceId,
    origin_page_id: page.originPageId,
  };
}
