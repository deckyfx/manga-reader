/**
 * Reader API (`/read/api`): everything a reader needs, read-only. Creating and changing anything lives in
 * `/manage/api`, so the two areas stay apart (and can later be gated separately).
 *
 * GET /read/api/series             the library, filtered by title, tags and status; sorted by title or recency
 * GET /read/api/series/tags        every tag in use, with how many series carry it
 * GET /read/api/series/:id         one series with its volumes, their chapters, and any unsorted chapters
 * GET /read/api/series/:id/cover   the series cover (pinned, else newest, else its first page)
 * GET /read/api/series/:id/covers  every cover of the series
 * GET /read/api/series/:id/covers/:coverId  one of them
 * GET /read/api/chapters/:id       one chapter with its pages, in reading order
 * GET /read/api/pages/:id/image    a page image: the published result, else the original
 */
import Elysia, { t } from "elysia";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ErrBody } from "@/lib/schemas";
import { coverFilePath } from "@/services/library-covers";
import { CoverStore } from "@/stores/cover-store";
import { hasUnpublishedEdits, publishedFile } from "@/services/page-history";
import { ChapterStore, SeriesStore, SERIES_STATUSES, VolumeStore, type SeriesWithCounts } from "@/stores/library-store";
import { pageDir, PageStore } from "@/stores/page-store";
import type { Chapter, Page, Series, Volume } from "@/db/schema";

export const READING_DIRECTIONS = ["rtl", "ltr"] as const;

export const IdParam = t.Integer({ minimum: 1 });
export const PageIdParam = t.String({ pattern: "^[A-Za-z0-9-]+$" });

export const SeriesSchema = t.Object({
  id: t.Integer(),
  title: t.String(),
  synopsis: t.Nullable(t.String()),
  author: t.Nullable(t.String()),
  status: t.String(),
  reading_direction: t.UnionEnum([...READING_DIRECTIONS]),
  tags: t.Array(t.String()),
  chapters: t.Integer(),
  volumes: t.Integer(),
  /** True when a cover image can be fetched (uploaded, or a first page to fall back on). */
  has_cover: t.Boolean(),
  created_at: t.String(),
  updated_at: t.String(),
});

/** One piece of a series' cover art. */
export const CoverSchema = t.Object({
  id: t.Integer(),
  label: t.Nullable(t.String()),
  /** The one being shown right now: the pinned cover, or the newest when nothing is pinned. */
  current: t.Boolean(),
  /** Whether somebody chose this one, as opposed to it simply being the newest. */
  pinned: t.Boolean(),
  created_at: t.String(),
});

export const VolumeSchema = t.Object({
  id: t.Integer(),
  series_id: t.Integer(),
  title: t.String(),
  number: t.Nullable(t.String()),
  sort_order: t.Integer(),
  created_at: t.String(),
  updated_at: t.String(),
});

export const ChapterSchema = t.Object({
  id: t.Integer(),
  series_id: t.Integer(),
  volume_id: t.Nullable(t.Integer()),
  title: t.String(),
  number: t.Nullable(t.String()),
  sort_order: t.Integer(),
  pages: t.Integer(),
  created_at: t.String(),
  updated_at: t.String(),
});

export const ReadPageSchema = t.Object({
  id: t.String(),
  chapter_id: t.Nullable(t.Integer()),
  name: t.Nullable(t.String()),
  sort_order: t.Integer(),
  status: t.String(),
  width: t.Integer(),
  height: t.Integer(),
  /** A translated image is what the reader gets for this page, rather than the original. */
  has_result: t.Boolean(),
  /** The page has been published at least once: readers are served that snapshot. */
  published: t.Boolean(),
  /** result.png holds work newer than the last publish — the Studio has edits readers can't see yet. */
  has_edits: t.Boolean(),
  revision: t.Integer(),
  updated_at: t.String(),
});

const VolumeWithChapters = t.Composite([VolumeSchema, t.Object({ chapters: t.Array(ChapterSchema) })]);

export const SeriesDetail = t.Object({
  series: SeriesSchema,
  volumes: t.Array(VolumeWithChapters),
  /** Chapters that aren't in a volume. */
  unsorted: t.Array(ChapterSchema),
});

export const ChapterDetail = t.Object({
  chapter: ChapterSchema,
  series: SeriesSchema,
  /** The series' chapters in order, so the reader can step into the next one. */
  siblings: t.Array(ChapterSchema),
  pages: t.Array(ReadPageSchema),
});

/** What the reader is actually served for this page: a translation, or the original (or nothing at all). */
export const hasResult = (page: Page): boolean => {
  const file = pageImagePath(page.id);
  return file !== null && file !== join(pageDir(page.id), "original.png");
};

export const toPage = (page: Page) => ({
  id: page.id,
  chapter_id: page.chapterId,
  name: page.name,
  sort_order: page.sortOrder,
  status: page.status,
  width: page.width,
  height: page.height,
  has_result: hasResult(page),
  published: publishedFile(page.id) !== null,
  has_edits: hasUnpublishedEdits(page.id),
  revision: page.revision,
  updated_at: page.updatedAt,
});

export const toVolume = (volume: Volume) => ({
  id: volume.id,
  series_id: volume.seriesId,
  title: volume.title,
  number: volume.number,
  sort_order: volume.sortOrder,
  created_at: volume.createdAt,
  updated_at: volume.updatedAt,
});

export const toChapter = (chapter: Chapter, pages: number) => ({
  id: chapter.id,
  series_id: chapter.seriesId,
  volume_id: chapter.volumeId,
  title: chapter.title,
  number: chapter.number,
  sort_order: chapter.sortOrder,
  pages,
  created_at: chapter.createdAt,
  updated_at: chapter.updatedAt,
});

/**
 * The file the cover route would serve: the series' cover art — the pinned one, else the newest — and failing that
 * the first page of its first chapter. A cover row whose file has gone falls through to the page, so a half-deleted
 * cover leaves a series looking bare rather than broken.
 */
export function coverFile(entry: SeriesWithCounts): string | null {
  const art = entry.coverArt ? coverFilePath(entry.coverArt) : null;
  if (art && existsSync(art)) return art;
  return entry.firstPageId ? pageImagePath(entry.firstPageId) : null;
}

export const toSeries = (entry: SeriesWithCounts) => ({
  id: entry.series.id,
  title: entry.series.title,
  synopsis: entry.series.synopsis,
  author: entry.series.author,
  status: entry.series.status,
  reading_direction: entry.series.readingDirection === "ltr" ? ("ltr" as const) : ("rtl" as const),
  tags: entry.tags,
  chapters: entry.chapters,
  volumes: entry.volumes,
  has_cover: coverFile(entry) !== null,
  created_at: entry.series.createdAt,
  updated_at: entry.series.updatedAt,
});

/**
 * Every cover of a series, newest first, as both areas return them. `current` is the one a reader is being shown,
 * which is the pinned cover when there is one and the newest otherwise — so the gallery and the cover route can
 * never disagree about which is on display.
 */
export async function coverList(seriesId: number) {
  const [entry, covers] = await Promise.all([SeriesStore.withCounts(seriesId), CoverStore.list(seriesId)]);
  return covers.map((cover) => ({
    id: cover.id,
    label: cover.label,
    current: cover.path === entry?.coverArt,
    pinned: entry?.series.coverId === cover.id,
    created_at: cover.createdAt,
  }));
}

/** One series with its tags, counts and cover state, as both areas return it. */
export async function seriesSummary(id: number): Promise<ReturnType<typeof toSeries> | null> {
  const entry = await SeriesStore.withCounts(id);
  return entry ? toSeries(entry) : null;
}

/** A series with its volumes, the chapters in each, and the chapters not in any volume. */
export async function seriesDetail(id: number) {
  const summary = await seriesSummary(id);
  if (!summary) return null;
  const [volumeRows, chapterRows] = await Promise.all([VolumeStore.listBySeries(id), ChapterStore.listBySeries(id)]);
  const counts = await PageStore.countsByChapter(chapterRows.map((chapter) => chapter.id));
  const chaptersOf = (volumeId: number | null) =>
    chapterRows.filter((chapter) => chapter.volumeId === volumeId).map((chapter) => toChapter(chapter, counts.get(chapter.id) ?? 0));
  return {
    series: summary,
    volumes: volumeRows.map((volume) => ({ ...toVolume(volume), chapters: chaptersOf(volume.id) })),
    unsorted: chaptersOf(null),
  };
}

/** One chapter with its pages and the series' chapter list (for next / previous chapter). */
export async function chapterDetail(id: number) {
  const chapter = await ChapterStore.findById(id);
  if (!chapter) return null;
  const summary = await seriesSummary(chapter.seriesId);
  if (!summary) return null;
  const [pages, siblings] = await Promise.all([PageStore.listByChapter(id), ChapterStore.listBySeries(chapter.seriesId)]);
  const counts = await PageStore.countsByChapter(siblings.map((sibling) => sibling.id));
  return {
    chapter: toChapter(chapter, pages.length),
    series: summary,
    siblings: siblings.map((sibling) => toChapter(sibling, counts.get(sibling.id) ?? 0)),
    pages: pages.map(toPage),
  };
}

/**
 * The image a reader gets: the newest published snapshot, else the original it was imported from. A burnt
 * `result.png` is deliberately not offered — work reaches readers by being published and no other way, so editing a
 * page in the Studio changes nothing for them until somebody publishes it.
 *
 * Pages burnt before publishing existed were once served from their burn here. `services/publish-backfill.ts`
 * publishes those once, at boot and from the admin area, so this no longer has to guess.
 */
export function pageImagePath(pageId: string): string | null {
  const published = publishedFile(pageId);
  if (published) return published;
  const original = join(pageDir(pageId), "original.png");
  return existsSync(original) ? original : null;
}

export const readPlugin = new Elysia({ prefix: "/read/api" })

  .get(
    "/series",
    async ({ query }) => {
      const list = await SeriesStore.list({
        search: query.q,
        withTags: query.tags?.split(",").filter(Boolean),
        withoutTags: query.exclude?.split(",").filter(Boolean),
        hasChapters: query.has_chapters === "true",
        status: SERIES_STATUSES.find((status) => status === query.status),
        sort: query.sort === "recent" ? "recent" : "title",
      });
      return list.map(toSeries);
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 200 })),
        /** Comma-separated; a series must carry all of them. */
        tags: t.Optional(t.String({ maxLength: 500 })),
        /** Comma-separated; a series carrying any of them is left out. */
        exclude: t.Optional(t.String({ maxLength: 500 })),
        has_chapters: t.Optional(t.String()),
        status: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      }),
      response: { 200: t.Array(SeriesSchema) },
    },
  )

  .get("/series/tags", () => SeriesStore.allTags(), {
    response: { 200: t.Array(t.Object({ tag: t.String(), count: t.Integer() })) },
  })

  .get(
    "/series/:id",
    async ({ params, status }) => (await seriesDetail(params.id)) ?? status(404, { error: "series not found" }),
    { params: t.Object({ id: IdParam }), response: { 200: SeriesDetail, 404: ErrBody } },
  )

  .get(
    "/series/:id/cover",
    async ({ params, status }) => {
      const entry = await SeriesStore.withCounts(params.id);
      if (!entry) return status(404, { error: "series not found" });
      // The uploaded cover, else the first page of the first chapter
      const file = coverFile(entry);
      if (!file) return status(404, { error: "this series has no cover yet" });
      return new Response(Bun.file(file), { headers: { "content-type": "image/png", "cache-control": "no-cache" } });
    },
    { params: t.Object({ id: IdParam }) },
  )

  .get(
    "/series/:id/covers",
    async ({ params, status }) => {
      if (!(await SeriesStore.findById(params.id))) return status(404, { error: "series not found" });
      return coverList(params.id);
    },
    { params: t.Object({ id: IdParam }), response: { 200: t.Array(CoverSchema), 404: ErrBody } },
  )

  .get(
    "/series/:id/covers/:coverId",
    async ({ params, status }) => {
      const cover = await CoverStore.find(params.id, params.coverId);
      if (!cover) return status(404, { error: "no such cover" });
      const file = coverFilePath(cover.path);
      if (!existsSync(file)) return status(404, { error: "that cover's image is missing" });
      return new Response(Bun.file(file), { headers: { "content-type": "image/png", "cache-control": "no-cache" } });
    },
    { params: t.Object({ id: IdParam, coverId: IdParam }) },
  )

  .get(
    "/chapters/:id",
    async ({ params, status }) => (await chapterDetail(params.id)) ?? status(404, { error: "chapter not found" }),
    { params: t.Object({ id: IdParam }), response: { 200: ChapterDetail, 404: ErrBody } },
  )

  .get(
    "/pages/:id/image",
    async ({ params, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      const file = pageImagePath(params.id);
      if (!file) return status(404, { error: "this page has no image yet" });
      return new Response(Bun.file(file), { headers: { "content-type": "image/png", "cache-control": "no-cache" } });
    },
    { params: t.Object({ id: PageIdParam }) },
  );
