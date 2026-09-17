/**
 * Library management API (`/manage/api`): everything that creates or changes the library. Reading stays in
 * `/read/api`, so this whole area can later be put behind a sign-in without touching the reader.
 *
 * POST   /manage/api/series                     create a series (title, synopsis, author, status, direction, tags)
 * PUT    /manage/api/series/:id                 edit it; `tags` replaces the whole set
 * PUT    /manage/api/series/:id/cover           upload a cover image (multipart)
 * DELETE /manage/api/series/:id/cover           drop the cover, falling back to the first page
 * DELETE /manage/api/series/:id                 delete a series with its volumes and chapters (pages → Inbox)
 * POST   /manage/api/volumes                    add a volume to a series
 * PUT    /manage/api/volumes/:id                rename / renumber / reorder it
 * DELETE /manage/api/volumes/:id                delete it (its chapters stay in the series, unsorted)
 * POST   /manage/api/chapters                   add a chapter to a series (optionally inside a volume)
 * PUT    /manage/api/chapters/:id               rename / renumber / reorder / move between volumes
 * DELETE /manage/api/chapters/:id               delete it (its pages → Inbox)
 * POST   /manage/api/chapters/:id/pages         file images or ZIP / CBZ archives into a chapter (multipart)
 * PUT    /manage/api/chapters/:id/pages/reorder set the chapter's reading order
 * GET    /manage/api/chapters/:id/export        the chapter as a ZIP of published images
 * POST   /manage/api/chapters/:id/run           translate the chapter (skips finished pages unless forced)
 * GET    /manage/api/chapters/:id/run           progress of that run
 * GET    /manage/api/inbox                      pages not filed into a chapter yet
 * PUT    /manage/api/pages/:id                  move a page between chapters / the Inbox, rename, reorder
 * DELETE /manage/api/pages/:id                  take a page out of its chapter (back to the Inbox)
 */
import Elysia, { t } from "elysia";
import { childLogger } from "@/lib/logger";
import { ErrBody } from "@/lib/schemas";
import { chapterRun, pagesToRun, startChapterRun } from "@/services/chapter-batch";
import { exportChapter } from "@/services/chapter-export";
import { importIntoChapter, type ImportSource } from "@/services/chapter-import";
import { CoverTooLargeError, deleteCover, saveCover } from "@/services/library-covers";
import { ChapterStore, SeriesStore, SERIES_STATUSES, VolumeStore } from "@/stores/library-store";
import { PageStore } from "@/stores/page-store";
import {
  chapterDetail,
  ChapterDetail,
  IdParam,
  PageIdParam,
  ReadPageSchema,
  READING_DIRECTIONS,
  seriesDetail,
  SeriesDetail,
  toPage,
} from "@/plugins/read/index";

const log = childLogger("manage");

const Title = t.String({ minLength: 1, maxLength: 200 });
const Tags = t.Array(t.String({ maxLength: 40 }), { maxItems: 30 });

/** Progress of a chapter batch run (in memory; a restart cancels it). */
const ChapterRunSchema = t.Object({
  chapterId: t.Integer(),
  running: t.Boolean(),
  total: t.Integer(),
  done: t.Integer(),
  failed: t.Integer(),
  currentPageId: t.Nullable(t.String()),
  startedAt: t.String(),
  finishedAt: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
});

export const managePlugin = new Elysia({ prefix: "/manage/api" })

  // ── Series ─────────────────────────────────────────────────────────────────

  .post(
    "/series",
    async ({ body, status }) => {
      const series = await SeriesStore.insert(
        {
          title: body.title,
          synopsis: body.synopsis ?? null,
          author: body.author ?? null,
          status: body.status ?? "ongoing",
          readingDirection: body.reading_direction ?? "rtl",
        },
        body.tags ?? [],
      );
      return (await seriesDetail(series.id)) ?? status(404, { error: "series not found" });
    },
    {
      body: t.Object({
        title: Title,
        synopsis: t.Optional(t.Nullable(t.String({ maxLength: 4000 }))),
        author: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        status: t.Optional(t.UnionEnum([...SERIES_STATUSES])),
        reading_direction: t.Optional(t.UnionEnum([...READING_DIRECTIONS])),
        tags: t.Optional(Tags),
      }),
      response: { 200: SeriesDetail, 404: ErrBody },
    },
  )

  .put(
    "/series/:id",
    async ({ params, body, status }) => {
      const updated = await SeriesStore.update(
        params.id,
        {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.synopsis !== undefined ? { synopsis: body.synopsis } : {}),
          ...(body.author !== undefined ? { author: body.author } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.reading_direction !== undefined ? { readingDirection: body.reading_direction } : {}),
        },
        body.tags,
      );
      if (!updated) return status(404, { error: "series not found" });
      return (await seriesDetail(params.id)) ?? status(404, { error: "series not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({
        title: t.Optional(Title),
        synopsis: t.Optional(t.Nullable(t.String({ maxLength: 4000 }))),
        author: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        status: t.Optional(t.UnionEnum([...SERIES_STATUSES])),
        reading_direction: t.Optional(t.UnionEnum([...READING_DIRECTIONS])),
        /** Replaces the series' whole tag set. */
        tags: t.Optional(Tags),
      }),
      response: { 200: SeriesDetail, 404: ErrBody },
    },
  )

  .put(
    "/series/:id/cover",
    async ({ params, body, status }) => {
      const series = await SeriesStore.findById(params.id);
      if (!series) return status(404, { error: "series not found" });
      let name: string;
      try {
        name = await saveCover(params.id, new Uint8Array(await body.cover.arrayBuffer()));
      } catch (err) {
        if (err instanceof CoverTooLargeError) return status(422, { error: err.message });
        log.warn({ err, seriesId: params.id }, "Cover could not be stored");
        return status(422, { error: "cover image could not be read" });
      }
      await SeriesStore.update(params.id, { coverPath: name });
      return (await seriesDetail(params.id)) ?? status(404, { error: "series not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({ cover: t.File() }),
      response: { 200: SeriesDetail, 404: ErrBody, 422: ErrBody },
    },
  )

  .delete(
    "/series/:id/cover",
    async ({ params, status }) => {
      const series = await SeriesStore.findById(params.id);
      if (!series) return status(404, { error: "series not found" });
      await deleteCover(series.coverPath);
      await SeriesStore.update(params.id, { coverPath: null });
      return (await seriesDetail(params.id)) ?? status(404, { error: "series not found" });
    },
    { params: t.Object({ id: IdParam }), response: { 200: SeriesDetail, 404: ErrBody } },
  )

  .delete(
    "/series/:id",
    async ({ params, status }) => {
      const series = await SeriesStore.findById(params.id);
      if (!series) return status(404, { error: "series not found" });
      // Volumes and chapters go with it; the pages keep their images and return to the Inbox
      await SeriesStore.delete(params.id);
      await deleteCover(series.coverPath);
      return { deleted: true };
    },
    { params: t.Object({ id: IdParam }), response: { 200: t.Object({ deleted: t.Boolean() }), 404: ErrBody } },
  )

  // ── Volumes ────────────────────────────────────────────────────────────────

  .post(
    "/volumes",
    async ({ body, status }) => {
      if (!(await SeriesStore.findById(body.series_id))) return status(404, { error: "series not found" });
      await VolumeStore.insert({
        seriesId: body.series_id,
        title: body.title,
        number: body.number ?? null,
        sortOrder: body.sort_order ?? (await VolumeStore.nextOrder(body.series_id)),
      });
      return (await seriesDetail(body.series_id)) ?? status(404, { error: "series not found" });
    },
    {
      body: t.Object({
        series_id: IdParam,
        title: Title,
        number: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        sort_order: t.Optional(t.Integer({ minimum: 0 })),
      }),
      response: { 200: SeriesDetail, 404: ErrBody },
    },
  )

  .put(
    "/volumes/:id",
    async ({ params, body, status }) => {
      const volume = await VolumeStore.findById(params.id);
      if (!volume) return status(404, { error: "volume not found" });
      await VolumeStore.update(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.number !== undefined ? { number: body.number } : {}),
        ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
      });
      return (await seriesDetail(volume.seriesId)) ?? status(404, { error: "series not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({
        title: t.Optional(Title),
        number: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        sort_order: t.Optional(t.Integer({ minimum: 0 })),
      }),
      response: { 200: SeriesDetail, 404: ErrBody },
    },
  )

  .delete(
    "/volumes/:id",
    async ({ params, status }) => {
      const volume = await VolumeStore.findById(params.id);
      if (!volume) return status(404, { error: "volume not found" });
      // Its chapters stay in the series, listed as unsorted
      await VolumeStore.delete(params.id);
      return (await seriesDetail(volume.seriesId)) ?? status(404, { error: "series not found" });
    },
    { params: t.Object({ id: IdParam }), response: { 200: SeriesDetail, 404: ErrBody } },
  )

  // ── Chapters ───────────────────────────────────────────────────────────────

  .post(
    "/chapters",
    async ({ body, status }) => {
      if (!(await SeriesStore.findById(body.series_id))) return status(404, { error: "series not found" });
      if (body.volume_id !== undefined && body.volume_id !== null) {
        const volume = await VolumeStore.findById(body.volume_id);
        if (!volume || volume.seriesId !== body.series_id) return status(404, { error: "volume not found in this series" });
      }
      await ChapterStore.insert({
        seriesId: body.series_id,
        volumeId: body.volume_id ?? null,
        title: body.title,
        number: body.number ?? null,
        sortOrder: body.sort_order ?? (await ChapterStore.nextOrder(body.series_id)),
      });
      return (await seriesDetail(body.series_id)) ?? status(404, { error: "series not found" });
    },
    {
      body: t.Object({
        series_id: IdParam,
        volume_id: t.Optional(t.Nullable(IdParam)),
        title: Title,
        number: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        sort_order: t.Optional(t.Integer({ minimum: 0 })),
      }),
      response: { 200: SeriesDetail, 404: ErrBody },
    },
  )

  .put(
    "/chapters/:id",
    async ({ params, body, status }) => {
      const chapter = await ChapterStore.findById(params.id);
      if (!chapter) return status(404, { error: "chapter not found" });
      if (body.volume_id !== undefined && body.volume_id !== null) {
        const volume = await VolumeStore.findById(body.volume_id);
        if (!volume || volume.seriesId !== chapter.seriesId) return status(404, { error: "volume not found in this series" });
      }
      await ChapterStore.update(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.number !== undefined ? { number: body.number } : {}),
        ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
        ...(body.volume_id !== undefined ? { volumeId: body.volume_id } : {}),
      });
      return (await seriesDetail(chapter.seriesId)) ?? status(404, { error: "series not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({
        title: t.Optional(Title),
        number: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        sort_order: t.Optional(t.Integer({ minimum: 0 })),
        /** null takes the chapter out of its volume, keeping it in the series. */
        volume_id: t.Optional(t.Nullable(IdParam)),
      }),
      response: { 200: SeriesDetail, 404: ErrBody },
    },
  )

  .delete(
    "/chapters/:id",
    async ({ params, status }) => {
      const chapter = await ChapterStore.findById(params.id);
      if (!chapter) return status(404, { error: "chapter not found" });
      // The pages keep their images and return to the Inbox
      await ChapterStore.delete(params.id);
      return (await seriesDetail(chapter.seriesId)) ?? status(404, { error: "series not found" });
    },
    { params: t.Object({ id: IdParam }), response: { 200: SeriesDetail, 404: ErrBody } },
  )

  // ── Pages of a chapter ─────────────────────────────────────────────────────

  .post(
    "/chapters/:id/pages",
    async ({ params, body, status }) => {
      if (!(await ChapterStore.findById(params.id))) return status(404, { error: "chapter not found" });
      const uploads = Array.isArray(body.files) ? body.files : [body.files];
      const sources: ImportSource[] = [];
      for (const file of uploads) sources.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
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
      if (!(await ChapterStore.findById(params.id))) return status(404, { error: "chapter not found" });
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
      const chapter = await ChapterStore.findById(params.id);
      if (!chapter) return status(404, { error: "chapter not found" });
      const { bytes, pages, missing } = await exportChapter(params.id);
      if (pages === 0) return status(409, { error: "this chapter has no page images to export" });
      if (missing > 0) log.warn({ chapterId: params.id, missing }, "Exported a chapter with missing page images");
      // Control characters would break (or let someone forge) the Content-Disposition header
      const name = chapter.title.replace(/[\\/:*?"<>|]+/g, "_").replace(/[ -]/g, "").trim() || `chapter-${chapter.id}`;
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

  .post(
    "/chapters/:id/run",
    async ({ params, body, status }) => {
      if (!(await ChapterStore.findById(params.id))) return status(404, { error: "chapter not found" });
      const state = await startChapterRun(params.id, { force: body?.force ?? false, cleanSfx: body?.clean_sfx ?? false });
      if (!state) return status(409, { error: "this chapter is already being translated" });
      return status(202, state);
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Optional(t.Object({ force: t.Optional(t.Boolean()), clean_sfx: t.Optional(t.Boolean()) })),
      response: { 202: ChapterRunSchema, 404: ErrBody, 409: ErrBody },
    },
  )

  .get(
    "/chapters/:id/run",
    async ({ params, status }) => {
      if (!(await ChapterStore.findById(params.id))) return status(404, { error: "chapter not found" });
      const state = chapterRun(params.id);
      // No run yet: report what one would do now, so the button can show the count
      return state ?? { chapter_id: params.id, pending: (await pagesToRun(params.id, false)).length };
    },
    {
      params: t.Object({ id: IdParam }),
      response: { 200: t.Union([ChapterRunSchema, t.Object({ chapter_id: t.Integer(), pending: t.Integer() })]), 404: ErrBody },
    },
  )

  // ── Pages ──────────────────────────────────────────────────────────────────

  .get("/inbox", async () => (await PageStore.listInbox()).map(toPage), { response: { 200: t.Array(ReadPageSchema) } })

  .put(
    "/pages/:id",
    async ({ params, body, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      if (body.chapter_id !== undefined && body.chapter_id !== null && !(await ChapterStore.findById(body.chapter_id))) {
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
      response: { 200: ReadPageSchema, 404: ErrBody },
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
    { params: t.Object({ id: PageIdParam }), response: { 200: ReadPageSchema, 404: ErrBody } },
  );
