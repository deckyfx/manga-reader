import { treaty } from "@elysiajs/eden";
import type { FontVariant, TextStyle } from "../../src/shared/typeset";
import type { App } from "../../src/index";

/** Type-safe API client via Eden Treaty; request and response shapes come from the server's route schemas. */
export const api = treaty<App>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3579",
);

/** Readable message from an Eden error: the server's `{ error }` body, a validation summary, or the status. */
function errorText(error: unknown): string {
  if (error && typeof error === "object" && "value" in error) {
    const value = (error as { value: unknown }).value;
    if (typeof value === "string" && value) return value;
    if (value && typeof value === "object") {
      const body = value as { error?: unknown; summary?: unknown; message?: unknown };
      for (const field of [body.error, body.summary, body.message]) {
        if (typeof field === "string" && field) return field;
      }
    }
  }
  return "API error";
}

/** An API failure that kept its status, so 401 (signed out) can be told from 500 (broken). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** The response body of a successful Eden call; throws with the server's message otherwise. */
async function unwrap<R extends { data: unknown; error: unknown }>(call: Promise<R>): Promise<NonNullable<R["data"]>> {
  const { data, error } = await call;
  if (error || data === null || data === undefined) {
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
    throw new ApiError(errorText(error), status);
  }
  return data as NonNullable<R["data"]>;
}

// ── Health / Settings ─────────────────────────────────────────────────────────

export const getHealth = () => unwrap(api.health.get());

export const getSettings = () => unwrap(api.api.settings.get());

export const patchEngine = (engine: string) => unwrap(api.api.settings.engine.patch({ engine }));

// ── Accounts ──────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "contributor" | "reader";
/** What a self-registered account may start as; the server refuses admin here. */
export type RegistrationRole = Exclude<UserRole, "admin">;
export type SecondFactor = "totp" | "passkey";

/** Who is signed in, what guards the account, and whether the server is still waiting to be set up. */
export const getMe = () => unwrap(api.auth.api.me.get());

/** Creates the first admin on an empty server; the route closes behind itself. */
export const setupFirstAdmin = (body: { username: string; password: string; display_name?: string | null }) =>
  unwrap(api.auth.api.setup.post(body));

/** Creates your own account, when an admin has switched registration on. */
export const register = (body: { username: string; password: string; display_name?: string | null }) =>
  unwrap(api.auth.api.register.post(body));

/**
 * Signs in. An account with a second factor gets no session yet: the answer carries `mfa_required`, the methods it
 * accepts and a short-lived challenge to finish with.
 */
export const login = (body: { username: string; password: string }) => unwrap(api.auth.api.login.post(body));

export const loginWithTotp = (body: { challenge: string; code: string }) => unwrap(api.auth.api.login.totp.post(body));

export const loginWithRecoveryCode = (body: { challenge: string; code: string }) =>
  unwrap(api.auth.api.login.recovery.post(body));

/** The WebAuthn request for a sign-in waiting on a passkey. */
export const passkeyLoginOptions = (challenge: string) => unwrap(api.auth.api.login.passkey.options.post({ challenge }));

export const loginWithPasskey = (body: { challenge: string; response: unknown }) =>
  unwrap(api.auth.api.login.passkey.post(body));

export const logout = () => unwrap(api.auth.api.logout.post());

/** Changes your own password; every other session is signed out. */
export const changePassword = (body: { current: string; next: string }) => unwrap(api.auth.api.password.post(body));

export const reissueRecoveryCodes = (password: string) => unwrap(api.auth.api.recovery.post({ password }));

// Authenticator apps — several per account

export const listAuthenticators = () => unwrap(api.auth.api.totp.get());

/** Starts enrolling one: answers with the secret and the otpauth:// URI to scan. */
export const addAuthenticator = (name: string) => unwrap(api.auth.api.totp.post({ name }));

/** Proves the app holds the secret. The first authenticator answers with the recovery codes. */
export const confirmAuthenticator = (id: number, code: string) =>
  unwrap(api.auth.api.totp({ id }).confirm.post({ code }));

export const removeAuthenticator = (id: number, password: string) =>
  unwrap(api.auth.api.totp({ id }).delete({ password }));

// Passkeys — several per account, enrolled from a signed-in session only

export const listPasskeys = () => unwrap(api.auth.api.passkeys.get());

export const passkeyRegistrationOptions = () => unwrap(api.auth.api.passkeys.options.post());

export const savePasskey = (body: { challenge: string; name: string; response: unknown }) =>
  unwrap(api.auth.api.passkeys.post(body));

export const removePasskey = (id: string, password: string) => unwrap(api.auth.api.passkeys({ id }).delete({ password }));

// API keys, for the extension and the desktop app

export const listApiKeys = () => unwrap(api.auth.api.keys.get());

/** The only time the key itself is readable. */
export const createApiKey = (name: string) => unwrap(api.auth.api.keys.post({ name }));

export const revokeApiKey = (id: number) => unwrap(api.auth.api.keys({ id }).delete());

// ── Server policy and accounts (admin) ───────────────────────────────────────

export const getServerPolicy = () => unwrap(api.manage.api.settings.get());

export const updateServerPolicy = (body: { registration_enabled?: boolean; default_role?: RegistrationRole }) =>
  unwrap(api.manage.api.settings.put(body));

export const listUsers = () => unwrap(api.manage.api.users.get());

export const createUser = (body: { username: string; password: string; role: UserRole; display_name?: string | null }) =>
  unwrap(api.manage.api.users.post(body));

export const updateUser = (id: number, body: { role?: UserRole; display_name?: string | null; password?: string; disabled?: boolean }) =>
  unwrap(api.manage.api.users({ id }).put(body));

export const deleteUser = (id: number) => unwrap(api.manage.api.users({ id }).delete());

// Sessions

/** Where this account is signed in; the current one is marked rather than offered for sign-out. */
export const listMySessions = () => unwrap(api.auth.api.sessions.get());

export const endMySession = (id: string) => unwrap(api.auth.api.sessions({ id }).delete());

export const listAllSessions = () => unwrap(api.manage.api.sessions.get());

export const endAnySession = (id: string) => unwrap(api.manage.api.sessions({ id }).delete());

export type Me = Awaited<ReturnType<typeof getMe>>;
export type SessionSummary = Awaited<ReturnType<typeof listMySessions>>[number];
export type AdminSession = Awaited<ReturnType<typeof listAllSessions>>[number];
export type AccountSummary = Awaited<ReturnType<typeof listUsers>>[number];
export type Account = NonNullable<Me["user"]>;
export type Authenticator = Awaited<ReturnType<typeof listAuthenticators>>[number];
export type Passkey = Awaited<ReturnType<typeof listPasskeys>>[number];
export type ApiKeySummary = Awaited<ReturnType<typeof listApiKeys>>[number];
export type ServerPolicy = Awaited<ReturnType<typeof getServerPolicy>>;

// ── Studio ────────────────────────────────────────────────────────────────────

/** Which pages the Studio lists: the Inbox (drafts), the pages inside chapters, or both. */
export type PageScope = "inbox" | "chapter" | "all";

export const listPages = (query: { filed?: PageScope; chapter_id?: number; q?: string } = {}) =>
  unwrap(api.studio.api.pages.get({ query }));

export const getPage = (id: string) => unwrap(api.studio.api.pages({ id }).get());

/**
 * Discards a page: its data and all its images. Refused while the page is being translated, and refused for a page
 * inside a chapter unless `force` — that page is part of what people read.
 */
export const deletePage = (id: string, force = false) =>
  unwrap(api.studio.api.pages({ id }).delete(undefined, { query: force ? { force: true } : {} }));

/** Queue a new page from an upload (base64 / data URL) or an image URL; progress arrives on `pageEventsUrl`. */
export const createPage = (body: { image?: string; url?: string; clean_sfx?: boolean; force?: boolean }) =>
  unwrap(api.studio.api.pages.post(body));

/** SSE stream of a page job's progress (Eden doesn't model EventSource). */
export const pageEventsUrl = (id: string) => `/api/translate-page/${id}/events`;

export type { PageJobEvent } from "../../src/stores/translation-job-store";

export type { FontVariant, LetteringPaths, TextAlign, TextPatch, TextStyle } from "../../src/shared/typeset";

/**
 * Edits a block's text, whether the clean pass removes its lettering (`include`), or its lettering style (`style`
 * replaces the stored overrides; null or {} resets to automatic).
 */
export const updateBlock = (
  id: string,
  idx: number,
  fields: { source_text?: string; translated_text?: string; include?: boolean; style?: TextStyle | null },
) => unwrap(api.studio.api.pages({ id }).blocks({ idx }).patch(fields));

/** Finds and stores each block's text area without burning, so lettering can be previewed right away. */
export const placeText = (id: string) => unwrap(api.studio.api.pages({ id }).place.post());

/** A lettering font, loaded by the Studio's live text preview. */
export const fontUrl = (variant: FontVariant) => `/studio/api/fonts/${variant}`;

/** Painted mask layers: `add` marks text the detector missed, `erase` marks art it wrongly took for text. */
export type MaskLayerName = "add" | "erase";

/** Saves a painted layer: a page-size PNG (data URL), white where painted. An empty layer is removed. */
export const saveMaskLayer = (id: string, layer: MaskLayerName, image: string) =>
  unwrap(api.studio.api.pages({ id }).mask({ layer }).put({ image }));

/** Cleans only these areas of the latest cleaned page again, using the detector mask plus the painted layers. */
export const recleanAreas = (id: string, areas: { x: number; y: number; w: number; h: number }[]) =>
  unwrap(api.studio.api.pages({ id }).reclean.post({ areas }));

/** Region outline stored with a block; rect is the default (returned as null). */
export type BlockShape =
  | { type: "rect" }
  | { type: "ellipse" }
  | { type: "polygon"; points: { x: number; y: number }[] };

/** Box (always bounding the shape) and optional outline, in page pixels. */
export interface BlockGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: BlockShape;
}

/** Content restored along with a region (e.g. undoing a delete), stored in the same request. */
export interface BlockContent {
  include?: boolean;
  source_text?: string | null;
  translated_text?: string | null;
  style?: TextStyle | null;
}

/** Adds a region drawn on the canvas; returns the page detail with the new block. */
export const createBlock = (id: string, kind: "text" | "sfx", geometry: BlockGeometry, content: BlockContent = {}) =>
  unwrap(api.studio.api.pages({ id }).blocks.post({ kind, ...content, ...geometry }));

/** Moves / resizes / reshapes a region. */
export const updateBlockGeometry = (id: string, idx: number, geometry: BlockGeometry) =>
  unwrap(api.studio.api.pages({ id }).blocks({ idx }).put(geometry));

/** Removes a region. */
export const deleteBlock = (id: string, idx: number) => unwrap(api.studio.api.pages({ id }).blocks({ idx }).delete());

/** Re-run OCR or translation (for `blockIds`, or every text block), clean text / sound effects, or typeset the page again. */
export const runStage = (id: string, stage: "ocr" | "translate" | "clean_text" | "clean_sfx" | "render", blockIds?: number[]) =>
  unwrap(api.studio.api.pages({ id }).run.post({ stage, block_ids: blockIds }));

export const publishPage = (id: string) => unwrap(api.studio.api.pages({ id }).publish.post());

export const listHistory = (id: string) => unwrap(api.studio.api.pages({ id }).history.get());

export const rollbackPage = (id: string, revision: number) =>
  unwrap(api.studio.api.pages({ id }).rollback.post({ revision }));

export const historyImageUrl = (id: string, revision: number) => `/studio/api/pages/${id}/history/${revision}`;

// ── Read (library + reader, read-only) ────────────────────────────────────────

export type ReadingDirection = "rtl" | "ltr";
export type SeriesStatus = "ongoing" | "completed" | "hiatus";

export interface SeriesQuery {
  q?: string;
  /** A series must carry all of these. */
  tags?: string[];
  /** A series carrying any of these is left out. */
  exclude?: string[];
  has_chapters?: boolean;
  status?: SeriesStatus;
  sort?: "title" | "recent";
}

export const listSeries = (query: SeriesQuery = {}) =>
  unwrap(api.read.api.series.get({
    query: {
      ...(query.q ? { q: query.q } : {}),
      ...(query.tags?.length ? { tags: query.tags.join(",") } : {}),
      ...(query.exclude?.length ? { exclude: query.exclude.join(",") } : {}),
      ...(query.has_chapters ? { has_chapters: "true" } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
    },
  }));

export const listSeriesTags = () => unwrap(api.read.api.series.tags.get());

export const getSeries = (id: number) => unwrap(api.read.api.series({ id }).get());

export const getChapter = (id: number) => unwrap(api.read.api.chapters({ id }).get());

/** Series cover: uploaded, else the first page of its first chapter. */
export const seriesCoverUrl = (id: number, version?: string | number) =>
  `/read/api/series/${id}/cover${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ""}`;

/** Page image for the reader: the published result, else the original. */
export const readPageImageUrl = (id: string, version?: string | number) =>
  `/read/api/pages/${id}/image${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ""}`;

// ── Manage (library editing) ──────────────────────────────────────────────────

export const createSeries = (body: {
  title: string;
  synopsis?: string | null;
  author?: string | null;
  status?: SeriesStatus;
  reading_direction?: ReadingDirection;
  tags?: string[];
}) => unwrap(api.manage.api.series.post(body));

export const updateSeries = (id: number, body: {
  title?: string;
  synopsis?: string | null;
  author?: string | null;
  status?: SeriesStatus;
  reading_direction?: ReadingDirection;
  /** Replaces the whole tag set. */
  tags?: string[];
}) => unwrap(api.manage.api.series({ id }).put(body));

export const uploadSeriesCover = (id: number, cover: File) => unwrap(api.manage.api.series({ id }).cover.put({ cover }));

export const removeSeriesCover = (id: number) => unwrap(api.manage.api.series({ id }).cover.delete());

export const deleteSeries = (id: number) => unwrap(api.manage.api.series({ id }).delete());

export const createVolume = (body: { series_id: number; title: string; number?: string | null }) =>
  unwrap(api.manage.api.volumes.post(body));

export const updateVolume = (id: number, body: { title?: string; number?: string | null; sort_order?: number }) =>
  unwrap(api.manage.api.volumes({ id }).put(body));

export const deleteVolume = (id: number) => unwrap(api.manage.api.volumes({ id }).delete());

export const createChapter = (body: { series_id: number; volume_id?: number | null; title: string; number?: string | null }) =>
  unwrap(api.manage.api.chapters.post(body));

export const updateChapter = (id: number, body: { title?: string; number?: string | null; sort_order?: number; volume_id?: number | null }) =>
  unwrap(api.manage.api.chapters({ id }).put(body));

export const deleteChapter = (id: number) => unwrap(api.manage.api.chapters({ id }).delete());

/** Files images or ZIP / CBZ archives into a chapter. */
export const importChapterPages = (id: number, files: File[]) => unwrap(api.manage.api.chapters({ id }).pages.post({ files }));

export const reorderChapterPages = (id: number, ids: string[]) => unwrap(api.manage.api.chapters({ id }).pages.reorder.put({ ids }));

export const chapterExportUrl = (id: number) => `/manage/api/chapters/${id}/export`;

/** Translates a chapter's pages: skips finished ones unless `force`. */
export const startChapterRun = (id: number, body?: { force?: boolean; clean_sfx?: boolean }) =>
  unwrap(api.manage.api.chapters({ id }).run.post(body ?? {}));

export const getChapterRun = (id: number) => unwrap(api.manage.api.chapters({ id }).run.get());

/** Pages that aren't in a chapter yet (extension jobs and uploads). */
export const listInbox = () => unwrap(api.manage.api.inbox.get());

/** Moves a page between chapters (null = Inbox), renames it, or sets its reading position. */
export const filePage = (id: string, body: { chapter_id?: number | null; sort_order?: number; name?: string | null }) =>
  unwrap(api.manage.api.pages({ id }).put(body));

/** Takes a page out of its chapter, keeping the page and its images. */
export const unfilePage = (id: string) => unwrap(api.manage.api.pages({ id }).delete());

/** Copies a draft into a chapter, keeping it in the Inbox; `keep_draft: false` moves the page instead. */
export const copyPageIntoChapter = (chapterId: number, pageId: string, body?: { keep_draft?: boolean; name?: string | null }) =>
  unwrap(api.manage.api.chapters({ id: chapterId }).pages({ pageId }).post(body ?? {}));

/** Publishes one page: what readers get catches up with the current burn. */
export const publishPageEdits = (id: string) => unwrap(api.manage.api.pages({ id }).publish.post());

/** Publishes every page of a chapter that holds unpublished edits. */
export const publishChapterEdits = (id: number) => unwrap(api.manage.api.chapters({ id }).publish.post());

/** Runs the whole pipeline again for one page, from its stored original. */
export const rerunPage = (id: string, body?: { clean_sfx?: boolean }) =>
  unwrap(api.studio.api.pages({ id }).rerun.post(body ?? {}));

export type SeriesSummary = Awaited<ReturnType<typeof listSeries>>[number];
export type SeriesDetail = Awaited<ReturnType<typeof getSeries>>;
export type VolumeWithChapters = SeriesDetail["volumes"][number];
export type ChapterSummary = SeriesDetail["unsorted"][number];
export type ChapterDetail = Awaited<ReturnType<typeof getChapter>>;
export type ReadPage = ChapterDetail["pages"][number];
export type ChapterRunState = Awaited<ReturnType<typeof getChapterRun>>;

export type StudioPageSummary = Awaited<ReturnType<typeof listPages>>[number];
export type StudioPageDetail = Awaited<ReturnType<typeof getPage>>;
export type StudioBlock = StudioPageDetail["blocks"][number];
export type StudioStage = StudioPageDetail["stages"][number];
/** Where a filed page sits: its series, its chapter and its place in the reading order. */
export type PageLocation = NonNullable<StudioPageDetail["page"]["location"]>;

/** Images stored per page, in pipeline order. */
export const PAGE_IMAGES = [
  { file: "original.png", label: "Original" },
  { file: "overlay.png", label: "Detection" },
  { file: "mask.png", label: "Detected text mask" },
  { file: "clean-text.png", label: "Cleaned text" },
  { file: "clean-sfx.png", label: "Cleaned SFX" },
  { file: "render-overlay.png", label: "Typeset areas" },
  { file: "result.png", label: "Result" },
] as const;

export type PageImage = (typeof PAGE_IMAGES)[number]["file"];

/** Every image the Studio loads for a page: the stage images plus the painted mask layers. */
export type PageFile = PageImage | "mask-add.png" | "mask-erase.png";

/** URL of a page image; `version` changes after edits so the browser doesn't show a cached copy. */
export const pageFileUrl = (id: string, file: PageFile, version?: string | number) =>
  `/studio/api/pages/${id}/files/${file}${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ""}`;
