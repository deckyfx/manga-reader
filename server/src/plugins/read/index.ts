/**
 * Reader API (`/read/api`): the library — volumes, chapters, the pages inside them, and the images the reader shows.
 *
 * GET    /read/api/volumes                    volumes with chapter counts
 * POST   /read/api/volumes                    create a volume
 * GET    /read/api/volumes/:id                one volume with its chapters (and page counts)
 * PUT    /read/api/volumes/:id                rename / set the reading direction / cover
 * DELETE /read/api/volumes/:id                delete a volume and its chapters (pages return to the Inbox)
 * POST   /read/api/chapters                   create a chapter in a volume
 * GET    /read/api/chapters/:id               one chapter with its pages, in reading order
 * PUT    /read/api/chapters/:id               rename / reorder the chapter
 * DELETE /read/api/chapters/:id               delete a chapter (its pages return to the Inbox)
 * POST   /read/api/chapters/:id/pages         file images or ZIP / CBZ archives into the chapter (multipart)
 * PUT    /read/api/chapters/:id/pages/reorder set the chapter's reading order
 * GET    /read/api/chapters/:id/export        the chapter as a ZIP of published images
 * GET    /read/api/inbox                      pages not filed into a chapter yet
 * PUT    /read/api/pages/:id                  move a page between chapters / the Inbox, rename, reorder
 * DELETE /read/api/pages/:id                  take a page out of its chapter (back to the Inbox)
 * GET    /read/api/pages/:id/image            the page image: published result, else the original
 */
import Elysia, { t } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import { exportChapter } from "@/services/chapter-export";
import { importIntoChapter, type ImportSource } from "@/services/chapter-import";
import { pageDir, PageStore } from "@/stores/page-store";
import { VolumeStore } from "@/stores/volume-store";
import type { Chapter, Page, Volume } from "@/db/schema";

const log = childLogger("read");

const READING_DIRECTIONS = ["rtl", "ltr"] as const;

const IdParam = t.Integer({ minimum: 1 });
const PageIdParam = t.String({ pattern: "^[A-Za-z0-9-]+$" });
const Title = t.String({ minLength: 1, maxLength: 200 });

const VolumeSchema = t.Object({
  id: t.Integer(),
  title: t.String(),
  cover_path: t.Nullable(t.String()),
  reading_direction: t.UnionEnum([...READING_DIRECTIONS]),
  chapters: t.Integer(),
  created_at: t.String(),
  updated_at: t.String(),
});

const ChapterSchema = t.Object({
  id: t.Integer(),
  volume_id: t.Integer(),
  title: t.String(),
  sort_order: t.Integer(),
  pages: t.Integer(),
  created_at: t.String(),
  updated_at: t.String(),
});

const PageSchema = t.Object({
  id: t.String(),
  chapter_id: t.Nullable(t.Integer()),
  name: t.Nullable(t.String()),
  sort_order: t.Integer(),
  source: t.String(),
  status: t.String(),
  width: t.Integer(),
  height: t.Integer(),
  /** A published result exists, so the reader shows the translation rather than the original. */
  has_result: t.Boolean(),
  revision: t.Integer(),
  updated_at: t.String(),
});

const VolumeDetail = t.Object({ volume: VolumeSchema, chapters: t.Array(ChapterSchema) });
const ChapterDetail = t.Object({ chapter: ChapterSchema, volume: VolumeSchema, pages: t.Array(PageSchema) });

const hasResult = (page: Page): boolean => existsSync(join(pageDir(page.id), "result.png"));

const toVolume = (volume: Volume, chapters: number) => ({
  id: volume.id,
  title: volume.title,
  cover_path: volume.coverPath,
  reading_direction: volume.readingDirection === "ltr" ? ("ltr" as const) : ("rtl" as const),
  chapters,
  created_at: volume.createdAt,
  updated_at: volume.updatedAt,
});

const toChapter = (chapter: Chapter, pages: number) => ({
  id: chapter.id,
  volume_id: chapter.volumeId,
  title: chapter.title,
  sort_order: chapter.sortOrder,
  pages,
  created_at: chapter.createdAt,
  updated_at: chapter.updatedAt,
});

const toPage = (page: Page) => ({
  id: page.id,
  chapter_id: page.chapterId,
  name: page.name,
  sort_order: page.sortOrder,
  source: page.source,
  status: page.status,
  width: page.width,
  height: page.height,
  has_result: hasResult(page),
  revision: page.revision,
  updated_at: page.updatedAt,
});

/** One volume with its chapters and their page counts. */
async function volumeDetail(id: number) {
  const volume = await VolumeStore.findById(id);
  if (!volume) return null;
  const chapters = await VolumeStore.listChapters(id);
  const counts = await PageStore.countsByChapter(chapters.map((c) => c.id));
  const chapterCount = chapters.length;
  return { volume: toVolume(volume, chapterCount), chapters: chapters.map((c) => toChapter(c, counts.get(c.id) ?? 0)) };
}

/** One chapter with its pages in reading order, plus the volume it belongs to. */
async function chapterDetail(id: number) {
  const chapter = await VolumeStore.findChapterById(id);
  if (!chapter) return null;
  const volume = await VolumeStore.findById(chapter.volumeId);
  if (!volume) return null;
  const [pages, volumeChapters] = await Promise.all([PageStore.listByChapter(id), VolumeStore.listChapters(chapter.volumeId)]);
  return { chapter: toChapter(chapter, pages.length), volume: toVolume(volume, volumeChapters.length), pages: pages.map(toPage) };
}

export const readPlugin = new Elysia({ prefix: "/read/api" })

  // ── Volumes ────────────────────────────────────────────────────────────────

  .get("/volumes", async () => (await VolumeStore.listWithCounts()).map(({ volume, chapters }) => toVolume(volume, chapters)), {
    response: { 200: t.Array(VolumeSchema) },
  })

  .post(
    "/volumes",
    async ({ body }) => {
      const volume = await VolumeStore.insert({ title: body.title, readingDirection: body.reading_direction ?? "rtl" });
      return toVolume(volume, 0);
    },
    {
      body: t.Object({ title: Title, reading_direction: t.Optional(t.UnionEnum([...READING_DIRECTIONS])) }),
      response: { 200: VolumeSchema },
    },
  )

  .get(
    "/volumes/:id",
    async ({ params, status }) => (await volumeDetail(params.id)) ?? status(404, { error: "volume not found" }),
    { params: t.Object({ id: IdParam }), response: { 200: VolumeDetail, 404: ErrBody } },
  )

  .put(
    "/volumes/:id",
    async ({ params, body, status }) => {
      const updated = await VolumeStore.update(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.reading_direction !== undefined ? { readingDirection: body.reading_direction } : {}),
        ...(body.cover_path !== undefined ? { coverPath: body.cover_path } : {}),
      });
      return updated ? ((await volumeDetail(params.id)) ?? status(404, { error: "volume not found" })) : status(404, { error: "volume not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({
        title: t.Optional(Title),
        reading_direction: t.Optional(t.UnionEnum([...READING_DIRECTIONS])),
        cover_path: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
      response: { 200: VolumeDetail, 404: ErrBody },
    },
  )

  .delete(
    "/volumes/:id",
    async ({ params, status }) => {
      if (!(await VolumeStore.findById(params.id))) return status(404, { error: "volume not found" });
      // Chapters go with it; their pages keep their images and return to the Inbox (pages.chapter_id → null)
      await VolumeStore.delete(params.id);
      return { deleted: true };
    },
    { params: t.Object({ id: IdParam }), response: { 200: t.Object({ deleted: t.Boolean() }), 404: ErrBody } },
  )

  // ── Chapters ───────────────────────────────────────────────────────────────

  .post(
    "/chapters",
    async ({ body, status }) => {
      if (!(await VolumeStore.findById(body.volume_id))) return status(404, { error: "volume not found" });
      const existing = await VolumeStore.listChapters(body.volume_id);
      // Append after the highest order in use, so deleting a chapter can't make two share a position
      const nextOrder = existing.reduce((max, chapter) => Math.max(max, chapter.sortOrder), 0) + 1;
      const chapter = await VolumeStore.insertChapter({
        volumeId: body.volume_id,
        title: body.title,
        sortOrder: body.sort_order ?? nextOrder,
      });
      return toChapter(chapter, 0);
    },
    {
      body: t.Object({ volume_id: IdParam, title: Title, sort_order: t.Optional(t.Integer({ minimum: 0 })) }),
      response: { 200: ChapterSchema, 404: ErrBody },
    },
  )

  .get(
    "/chapters/:id",
    async ({ params, status }) => (await chapterDetail(params.id)) ?? status(404, { error: "chapter not found" }),
    { params: t.Object({ id: IdParam }), response: { 200: ChapterDetail, 404: ErrBody } },
  )

  .put(
    "/chapters/:id",
    async ({ params, body, status }) => {
      const updated = await VolumeStore.updateChapter(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
      });
      if (!updated) return status(404, { error: "chapter not found" });
      return (await chapterDetail(params.id)) ?? status(404, { error: "chapter not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({ title: t.Optional(Title), sort_order: t.Optional(t.Integer({ minimum: 0 })) }),
      response: { 200: ChapterDetail, 404: ErrBody },
    },
  )

  .delete(
    "/chapters/:id",
    async ({ params, status }) => {
      if (!(await VolumeStore.findChapterById(params.id))) return status(404, { error: "chapter not found" });
      // The pages keep their images and return to the Inbox
      await VolumeStore.deleteChapter(params.id);
      return { deleted: true };
    },
    { params: t.Object({ id: IdParam }), response: { 200: t.Object({ deleted: t.Boolean() }), 404: ErrBody } },
  )

  // ── Pages of a chapter ─────────────────────────────────────────────────────

  .post(
    "/chapters/:id/pages",
    async ({ params, body, status }) => {
      if (!(await VolumeStore.findChapterById(params.id))) return status(404, { error: "chapter not found" });
      const uploads = Array.isArray(body.files) ? body.files : [body.files];
      const sources: ImportSource[] = [];
      for (const file of uploads) {
        sources.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
      const report = await importIntoChapter(params.id, sources);
      const detail = await chapterDetail(params.id);
      if (!detail) return status(404, { error: "chapter not found" });
      return { ...detail, imported: report.pages.length, skipped: report.skipped };
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({ files: t.Files() }),
      response: {
        200: t.Composite([ChapterDetail, t.Object({ imported: t.Integer(), skipped: t.Array(t.Object({ name: t.String(), reason: t.String() })) })]),
        404: ErrBody,
      },
    },
  )

  .put(
    "/chapters/:id/pages/reorder",
    async ({ params, body, status }) => {
      if (!(await VolumeStore.findChapterById(params.id))) return status(404, { error: "chapter not found" });
      const pages = await PageStore.listByChapter(params.id);
      const known = new Set(pages.map((page) => page.id));
      if (body.ids.length !== pages.length || body.ids.some((id) => !known.has(id))) {
        return status(422, { error: "the order must list every page of this chapter exactly once" });
      }
      if (new Set(body.ids).size !== body.ids.length) return status(422, { error: "the order repeats a page" });
      await PageStore.reorderChapter(params.id, body.ids);
      return (await chapterDetail(params.id)) ?? status(404, { error: "chapter not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({ ids: t.Array(PageIdParam, { maxItems: 2000 }) }),
      response: { 200: ChapterDetail, 404: ErrBody, 422: ErrBody },
    },
  )

  .get(
    "/chapters/:id/export",
    async ({ params, status }) => {
      const chapter = await VolumeStore.findChapterById(params.id);
      if (!chapter) return status(404, { error: "chapter not found" });
      const { bytes, pages, missing } = await exportChapter(params.id);
      if (pages === 0) return status(409, { error: "this chapter has no page images to export" });
      if (missing > 0) log.warn({ chapterId: params.id, missing }, "Exported a chapter with missing page images");
      // Control characters would break (or let someone forge) the Content-Disposition header
      const name = chapter.title.replace(/[\\/:*?"<>|]+/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim() || `chapter-${chapter.id}`;
      return new Response(bytes.buffer as ArrayBuffer, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${name}.zip"`,
          "content-length": String(bytes.byteLength),
        },
      });
    },
    { params: t.Object({ id: IdParam }) },
  )

  // ── Pages ──────────────────────────────────────────────────────────────────

  .get("/inbox", async () => (await PageStore.listInbox()).map(toPage), { response: { 200: t.Array(PageSchema) } })

  .put(
    "/pages/:id",
    async ({ params, body, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      if (body.chapter_id !== undefined && body.chapter_id !== null && !(await VolumeStore.findChapterById(body.chapter_id))) {
        return status(404, { error: "chapter not found" });
      }
      // Moving into a chapter appends it after the pages already there
      const sortOrder = body.sort_order
        ?? (body.chapter_id !== undefined && body.chapter_id !== null && body.chapter_id !== page.chapterId
          ? (await PageStore.maxSortOrder(body.chapter_id)) + 1
          : undefined);
      await PageStore.filePage(params.id, {
        ...(body.chapter_id !== undefined ? { chapterId: body.chapter_id } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
      });
      const updated = await PageStore.findById(params.id);
      return updated ? toPage(updated) : status(404, { error: "page not found" });
    },
    {
      params: t.Object({ id: PageIdParam }),
      body: t.Object({
        /** null returns the page to the Inbox. */
        chapter_id: t.Optional(t.Nullable(IdParam)),
        sort_order: t.Optional(t.Integer({ minimum: 0 })),
        name: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
      }),
      response: { 200: PageSchema, 404: ErrBody },
    },
  )

  .delete(
    "/pages/:id",
    async ({ params, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      // Only unfiles it: deleting the page and its images is the Studio's "Discard page"
      await PageStore.filePage(params.id, { chapterId: null, sortOrder: 0 });
      const updated = await PageStore.findById(params.id);
      return updated ? toPage(updated) : status(404, { error: "page not found" });
    },
    { params: t.Object({ id: PageIdParam }), response: { 200: PageSchema, 404: ErrBody } },
  )

  .get(
    "/pages/:id/image",
    async ({ params, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      const dir = pageDir(params.id);
      const result = join(dir, "result.png");
      const file = existsSync(result) ? result : join(dir, "original.png");
      if (!existsSync(file)) return status(404, { error: "this page has no image yet" });
      return new Response(Bun.file(file), {
        headers: { "content-type": "image/png", "cache-control": "no-cache" },
      });
    },
    { params: t.Object({ id: PageIdParam }) },
  );
