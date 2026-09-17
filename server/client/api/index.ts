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

/** The response body of a successful Eden call; throws with the server's message otherwise. */
async function unwrap<R extends { data: unknown; error: unknown }>(call: Promise<R>): Promise<NonNullable<R["data"]>> {
  const { data, error } = await call;
  if (error || data === null || data === undefined) throw new Error(errorText(error));
  return data as NonNullable<R["data"]>;
}

// ── Health / Settings ─────────────────────────────────────────────────────────

export const getHealth = () => unwrap(api.health.get());

export const getSettings = () => unwrap(api.api.settings.get());

export const patchEngine = (engine: string) => unwrap(api.api.settings.engine.patch({ engine }));

// ── Studio ────────────────────────────────────────────────────────────────────

export const listPages = () => unwrap(api.studio.api.pages.get());

export const getPage = (id: string) => unwrap(api.studio.api.pages({ id }).get());

/** Discards a page: its data and all its images. Refused while the page is being translated. */
export const deletePage = (id: string) => unwrap(api.studio.api.pages({ id }).delete());

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

// ── Read (library + reader) ───────────────────────────────────────────────────

export const listVolumes = () => unwrap(api.read.api.volumes.get());

export const createVolume = (body: { title: string; reading_direction?: ReadingDirection }) =>
  unwrap(api.read.api.volumes.post(body));

export const getVolume = (id: number) => unwrap(api.read.api.volumes({ id }).get());

export const updateVolume = (id: number, body: { title?: string; reading_direction?: ReadingDirection; cover_path?: string | null }) =>
  unwrap(api.read.api.volumes({ id }).put(body));

export const deleteVolume = (id: number) => unwrap(api.read.api.volumes({ id }).delete());

export const createChapter = (body: { volume_id: number; title: string; sort_order?: number }) =>
  unwrap(api.read.api.chapters.post(body));

export const getChapter = (id: number) => unwrap(api.read.api.chapters({ id }).get());

export const updateChapter = (id: number, body: { title?: string; sort_order?: number }) =>
  unwrap(api.read.api.chapters({ id }).put(body));

export const deleteChapter = (id: number) => unwrap(api.read.api.chapters({ id }).delete());

/** Files images or ZIP / CBZ archives into a chapter; returns the chapter with its pages and what was skipped. */
export const importChapterPages = (id: number, files: File[]) => unwrap(api.read.api.chapters({ id }).pages.post({ files }));

export const reorderChapterPages = (id: number, ids: string[]) =>
  unwrap(api.read.api.chapters({ id }).pages.reorder.put({ ids }));

/** Pages that aren't in a chapter yet (extension jobs and uploads). */
export const listInbox = () => unwrap(api.read.api.inbox.get());

/** Moves a page between chapters (null = Inbox), renames it, or sets its reading position. */
export const filePage = (id: string, body: { chapter_id?: number | null; sort_order?: number; name?: string | null }) =>
  unwrap(api.read.api.pages({ id }).put(body));

/** Takes a page out of its chapter, keeping the page and its images. */
export const unfilePage = (id: string) => unwrap(api.read.api.pages({ id }).delete());

/** Page image for the reader: the published result, else the original. `version` busts the browser cache. */
export const readPageImageUrl = (id: string, version?: string | number) =>
  `/read/api/pages/${id}/image${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ""}`;

export const chapterExportUrl = (id: number) => `/read/api/chapters/${id}/export`;

/** Translates a chapter's pages: skips finished ones unless `force`. */
export const startChapterRun = (id: number, body?: { force?: boolean; clean_sfx?: boolean }) =>
  unwrap(api.studio.api.chapters({ id }).run.post(body ?? {}));

export const getChapterRun = (id: number) => unwrap(api.studio.api.chapters({ id }).run.get());

/** Runs the whole pipeline again for one page, from its stored original. */
export const rerunPage = (id: string, body?: { clean_sfx?: boolean }) =>
  unwrap(api.studio.api.pages({ id }).rerun.post(body ?? {}));

export type ReadingDirection = "rtl" | "ltr";
export type VolumeSummary = Awaited<ReturnType<typeof listVolumes>>[number];
export type VolumeDetail = Awaited<ReturnType<typeof getVolume>>;
export type ChapterSummary = VolumeDetail["chapters"][number];
export type ChapterDetail = Awaited<ReturnType<typeof getChapter>>;
export type ReadPage = ChapterDetail["pages"][number];
export type ChapterRunState = Awaited<ReturnType<typeof getChapterRun>>;

export type StudioPageSummary = Awaited<ReturnType<typeof listPages>>[number];
export type StudioPageDetail = Awaited<ReturnType<typeof getPage>>;
export type StudioBlock = StudioPageDetail["blocks"][number];
export type StudioStage = StudioPageDetail["stages"][number];

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
