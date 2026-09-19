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
 * POST   /manage/api/chapters/:id/pages/:pageId copy an Inbox draft into the chapter (or move it, keep_draft=false)
 * PUT    /manage/api/chapters/:id/pages/reorder set the chapter's reading order
 * GET    /manage/api/chapters/:id/export        the chapter as a ZIP of published images
 * POST   /manage/api/chapters/:id/run           translate the chapter (skips finished pages unless forced)
 * GET    /manage/api/chapters/:id/run           progress of that run
 * POST   /manage/api/chapters/:id/publish       publish every page of the chapter that has unpublished edits
 * POST   /manage/api/pages/:id/publish          publish one page, so readers get its current result
 * GET    /manage/api/settings                   server policy: registration, default role (admin)
 * PUT    /manage/api/settings                   change it (admin)
 * GET    /manage/api/sessions                   every signed-in session (admin)
 * DELETE /manage/api/sessions/:id               sign one out (admin)
 * GET    /manage/api/users                      the accounts on this server (admin)
 * POST   /manage/api/users                      add an account (admin)
 * PUT    /manage/api/users/:id                  change a role, suspend, rename or reset a password (admin)
 * DELETE /manage/api/users/:id                  delete an account (admin)
 * GET    /manage/api/inbox                      pages not filed into a chapter yet
 * PUT    /manage/api/pages/:id                  move a page between chapters / the Inbox, rename, reorder
 * DELETE /manage/api/pages/:id                  take a page out of its chapter (back to the Inbox)
 */
import Elysia, { t } from "elysia";
import { childLogger } from "@/lib/logger";
import { ErrBody, optionalEnum } from "@/lib/schemas";
import { chapterRun, pagesToRun, startChapterRun } from "@/services/chapter-batch";
import { exportChapter } from "@/services/chapter-export";
import { importIntoChapter, type ImportSource } from "@/services/chapter-import";
import { hasUnpublishedEdits } from "@/services/page-history";
import { publishPage } from "@/services/page-publish";
import { withPageLock } from "@/queue/page-queue";
import { CoverTooLargeError, deleteCover, saveCover } from "@/services/library-covers";
import { copyPageIntoChapter } from "@/services/page-copy";
import { ChapterStore, SeriesStore, SERIES_STATUSES, VolumeStore } from "@/stores/library-store";
import { SessionStore, UserStore } from "@/stores/user-store";
import { hashSecret, SESSION_COOKIE } from "@/services/auth";
import { hashPassword } from "@/services/auth";
import { REGISTRATION_ROLES, serverPolicy, updateServerPolicy } from "@/services/server-settings";
import { authContext, SessionSchema, toUser, UserSchema } from "@/plugins/auth/index";
import { USER_ROLES } from "@/db/schema";
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
const ServerPolicySchema = t.Object({
  registration_enabled: t.Boolean(),
  default_role: t.UnionEnum([...REGISTRATION_ROLES]),
});

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
  // For `principal`: the guard in plugins/auth/guard.ts is what enforces the roles, this is how the handlers see who it is
  .use(authContext)

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
        status: optionalEnum(SERIES_STATUSES),
        reading_direction: optionalEnum(READING_DIRECTIONS),
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
        status: optionalEnum(SERIES_STATUSES),
        reading_direction: optionalEnum(READING_DIRECTIONS),
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

  .post(
    "/chapters/:id/pages/:pageId",
    async ({ params, body, status }) => {
      if (!(await ChapterStore.findById(params.id))) return status(404, { error: "chapter not found" });
      const page = await PageStore.findById(params.pageId);
      if (!page) return status(404, { error: "page not found" });
      if (page.chapterId === params.id) return status(409, { error: "this page is already in this chapter" });
      if (page.status === "queued" || page.status === "running") return status(409, { error: "page is still being translated" });
      // Copying out of another chapter is fine; taking a page out of one is a move, and that has its own route
      if (page.chapterId !== null && body?.keep_draft === false) {
        return status(409, { error: "this page belongs to a chapter — move it with PUT /manage/api/pages/:id, or copy it" });
      }

      // A draft is copied by default, so the Studio keeps the original to work from; keep_draft=false moves it instead
      let filed = page;
      if (body?.keep_draft === false) {
        await PageStore.filePage(params.pageId, { chapterId: params.id, sortOrder: (await PageStore.maxSortOrder(params.id)) + 1 });
        filed = (await PageStore.findById(params.pageId)) ?? page;
      } else {
        // Under the source's lock, which a pipeline run holds for its whole duration: the copy then reads one
        // settled state instead of a folder being rewritten around it
        const copied = await withPageLock(params.pageId, async () => {
          const fresh = await PageStore.findById(params.pageId);
          if (!fresh || fresh.status === "queued" || fresh.status === "running") return null;
          return copyPageIntoChapter(fresh, params.id, body?.name);
        });
        if (!copied) return status(409, { error: "page is still being translated" });
        filed = copied;
      }
      // A page that arrives already translated is published at once: readers only ever see published snapshots, and a
      // page nobody has read yet has nothing to protect from a publish
      if (hasUnpublishedEdits(filed.id)) await withPageLock(filed.id, () => publishPage(filed.id));
      return (await chapterDetail(params.id)) ?? status(404, { error: "chapter not found" });
    },
    {
      params: t.Object({ id: IdParam, pageId: PageIdParam }),
      body: t.Optional(t.Object({
        /** Default true: the page is copied and the draft stays where it is. False moves it, and only from the Inbox. */
        keep_draft: t.Optional(t.Boolean()),
        name: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
      })),
      response: { 200: ChapterDetail, 404: ErrBody, 409: ErrBody },
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

  .post(
    "/chapters/:id/publish",
    async ({ params, status }) => {
      if (!(await ChapterStore.findById(params.id))) return status(404, { error: "chapter not found" });
      const pages = await PageStore.listByChapter(params.id);
      // Only pages holding work readers can't see yet; a page still in the pipeline is left for the next publish
      const pending = pages.filter((page) => page.status !== "queued" && page.status !== "running" && hasUnpublishedEdits(page.id));
      for (const page of pending) await withPageLock(page.id, () => publishPage(page.id));
      const detail = await chapterDetail(params.id);
      if (!detail) return status(404, { error: "chapter not found" });
      log.info({ chapterId: params.id, published: pending.length }, "Published a chapter's edits");
      return { ...detail, published: pending.length };
    },
    {
      params: t.Object({ id: IdParam }),
      response: { 200: t.Composite([ChapterDetail, t.Object({ published: t.Integer() })]), 404: ErrBody },
    },
  )

  // ── Server policy (admin) ──────────────────────────────────────────────────

  .get(
    "/settings",
    async () => {
      const policy = await serverPolicy();
      return { registration_enabled: policy.registrationEnabled, default_role: policy.defaultRole };
    },
    { response: { 200: ServerPolicySchema } },
  )

  .put(
    "/settings",
    async ({ body }) => {
      const policy = await updateServerPolicy({
        ...(body.registration_enabled !== undefined ? { registrationEnabled: body.registration_enabled } : {}),
        ...(body.default_role !== undefined ? { defaultRole: body.default_role } : {}),
      });
      return { registration_enabled: policy.registrationEnabled, default_role: policy.defaultRole };
    },
    {
      body: t.Object({
        registration_enabled: t.Optional(t.Boolean()),
        /** What a self-registered account starts as; an admin can still promote it afterwards. Never admin. */
        default_role: optionalEnum(REGISTRATION_ROLES),
      }),
      response: { 200: ServerPolicySchema },
    },
  )

  // ── Sessions (admin) ───────────────────────────────────────────────────────

  .get(
    "/sessions",
    async ({ cookie }) => {
      const token = cookie[SESSION_COOKIE]?.value;
      const currentHash = typeof token === "string" && token ? hashSecret(token) : null;
      return (await SessionStore.listAll()).map(({ session, username }) => ({
        id: session.tokenHash,
        username,
        current: session.tokenHash === currentHash,
        user_agent: session.userAgent,
        last_seen_at: session.lastSeenAt,
        created_at: session.createdAt,
        expires_at: session.expiresAt,
      }));
    },
    { response: { 200: t.Array(t.Composite([SessionSchema, t.Object({ username: t.String() })])) } },
  )

  .delete(
    "/sessions/:id",
    async ({ params, status }) => {
      if (!(await SessionStore.find(params.id))) return status(404, { error: "no such session" });
      await SessionStore.delete(params.id);
      log.info({ session: params.id.slice(0, 8) }, "Session signed out by an admin");
      return { signed_out: true };
    },
    {
      params: t.Object({ id: t.String({ maxLength: 128 }) }),
      response: { 200: t.Object({ signed_out: t.Boolean() }), 404: ErrBody },
    },
  )

  // ── Accounts (admin; the guard's table is what enforces that) ──────────────

  .get("/users", async () => (await UserStore.list()).map(toUser), { response: { 200: t.Array(UserSchema) } })

  .post(
    "/users",
    async ({ body, status }) => {
      if (await UserStore.findByUsername(body.username)) return status(409, { error: "that username is taken" });
      const user = await UserStore.insertIfFree({
        username: body.username,
        displayName: body.display_name ?? null,
        passwordHash: await hashPassword(body.password),
        role: body.role,
      });
      // Taken between the check above and here
      if (!user) return status(409, { error: "that username is taken" });
      log.info({ userId: user.id, role: user.role }, "Account created");
      return toUser(user);
    },
    {
      body: t.Object({
        username: t.String({ minLength: 2, maxLength: 40, pattern: "^[A-Za-z0-9._-]+$" }),
        password: t.String({ minLength: 8, maxLength: 200 }),
        role: t.UnionEnum([...USER_ROLES]),
        display_name: t.Optional(t.Nullable(t.String({ maxLength: 80 }))),
      }),
      response: { 200: UserSchema, 409: ErrBody },
    },
  )

  .put(
    "/users/:id",
    async ({ params, body, principal, status }) => {
      const user = await UserStore.findById(params.id);
      if (!user) return status(404, { error: "user not found" });
      if (body.disabled === true && principal?.user.id === params.id) return status(409, { error: "you can't suspend yourself" });

      // The last admin keeps the keys: counted and applied together, so two demotions can't pass each other
      const costsAdmin = (body.role !== undefined && body.role !== "admin") || body.disabled === true;
      const outcome = await UserStore.updateGuardingLastAdmin(params.id, {
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
        ...(body.password !== undefined ? { passwordHash: await hashPassword(body.password) } : {}),
        ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date().toISOString() : null } : {}),
      }, costsAdmin);
      if (outcome === "missing") return status(404, { error: "user not found" });
      if (outcome === "last-admin") return status(409, { error: "this is the last admin" });
      // A new password, a lost role or a suspension all end the sessions that were running under the old terms
      if (body.password !== undefined || body.role !== undefined || body.disabled === true) await SessionStore.deleteForUser(params.id);
      const updated = await UserStore.findById(params.id);
      return updated ? toUser(updated) : status(404, { error: "user not found" });
    },
    {
      params: t.Object({ id: IdParam }),
      body: t.Object({
        role: optionalEnum(USER_ROLES),
        display_name: t.Optional(t.Nullable(t.String({ maxLength: 80 }))),
        password: t.Optional(t.String({ minLength: 8, maxLength: 200 })),
        disabled: t.Optional(t.Boolean()),
      }),
      response: { 200: UserSchema, 404: ErrBody, 409: ErrBody },
    },
  )

  .delete(
    "/users/:id",
    async ({ params, principal, status }) => {
      if (principal?.user.id === params.id) return status(409, { error: "you can't delete your own account" });
      const outcome = await UserStore.deleteGuardingLastAdmin(params.id);
      if (outcome === "missing") return status(404, { error: "user not found" });
      if (outcome === "last-admin") return status(409, { error: "this is the last admin" });
      log.info({ userId: params.id }, "Account deleted");
      return { deleted: true };
    },
    { params: t.Object({ id: IdParam }), response: { 200: t.Object({ deleted: t.Boolean() }), 404: ErrBody, 409: ErrBody } },
  )

  // ── Pages ──────────────────────────────────────────────────────────────────

  .post(
    "/pages/:id/publish",
    async ({ params, status }) => {
      const page = await PageStore.findById(params.id);
      if (!page) return status(404, { error: "page not found" });
      if (page.status === "queued" || page.status === "running") return status(409, { error: "page is still being translated" });
      if (!hasUnpublishedEdits(params.id)) return status(409, { error: "this page has nothing new to publish" });
      await withPageLock(params.id, () => publishPage(params.id));
      const updated = await PageStore.findById(params.id);
      return updated ? toPage(updated) : status(404, { error: "page not found" });
    },
    { params: t.Object({ id: PageIdParam }), response: { 200: ReadPageSchema, 404: ErrBody, 409: ErrBody } },
  )

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
