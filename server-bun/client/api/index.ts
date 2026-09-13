import { treaty } from "@elysiajs/eden";
import type { App } from "../../src/index";
import type {
  Chapter,
  HealthStatus,
  PageTranslationJob,
  ServerSettings,
  TextSegBlock,
  TranslationBubble,
  Volume,
} from "../types";

/**
 * Type-safe API client via Eden Treaty.
 * Route response schemas on the server enable full type inference here —
 * no `as any` or `as never` casts needed.
 */
export const api = treaty<App>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3579",
);

interface ApiError {
  value?: unknown;
}

async function unwrap<T>(
  call: Promise<{ data: T | null; error: ApiError | null }>,
): Promise<T> {
  const { data, error } = await call;
  if (error !== null || data === null) {
    throw new Error(String(error?.value ?? "API error"));
  }
  return data;
}

async function unwrapVoid(call: Promise<{ error: ApiError | null }>): Promise<void> {
  const { error } = await call;
  if (error !== null) throw new Error(String((error as ApiError)?.value ?? "API error"));
}

// ── Health / Settings ─────────────────────────────────────────────────────────

export const getHealth = () =>
  unwrap<HealthStatus>(api.health.get());

export const getSettings = () =>
  unwrap<ServerSettings>(api.api.settings.get());

export const patchEngine = (engine: string) =>
  unwrap<{ preferred_translation_engine: string }>(
    api.api.settings.engine.patch({ engine }),
  );

// ── Jobs ──────────────────────────────────────────────────────────────────────

export const listJobs = () =>
  unwrap<PageTranslationJob[]>(api.api.portal.jobs.get());

export const getJob = (id: string) =>
  unwrap<PageTranslationJob>(api.api.portal.jobs({ id }).get());

export const deleteJob = (id: string) =>
  unwrap<{ deleted: string }>(api.api.portal.jobs({ id }).delete());

// ── Job images (URL builders — no Eden call needed) ───────────────────────────

export const jobOriginalUrl = (id: string) => `/api/portal/jobs/${id}/original`;
export const jobInpaintedUrl = (id: string) => `/api/portal/jobs/${id}/inpainted`;
export const jobResultUrl = (id: string) => `/api/portal/jobs/${id}/result`;

// ── TextSeg blocks ────────────────────────────────────────────────────────────

export const getTextSegBlocks = (jobId: string) =>
  unwrap<TextSegBlock[]>(api.api.portal.jobs({ id: jobId })["textseg-blocks"].get());

export const addTextSegBlock = (
  jobId: string,
  block: Pick<TextSegBlock, "x" | "y" | "w" | "h">,
) =>
  unwrap<TextSegBlock>(
    api.api.portal.jobs({ id: jobId })["textseg-blocks"].post(block),
  );

export const deleteTextSegBlock = (jobId: string, blockId: string) =>
  unwrap<{ deleted: string }>(
    api.api.portal
      .jobs({ id: jobId })
      ["textseg-blocks"]({ blockId })
      .delete(),
  );

// ── Bubbles ───────────────────────────────────────────────────────────────────

export const getBubbles = (jobId: string) =>
  unwrap<TranslationBubble[]>(api.api.portal.jobs({ id: jobId }).bubbles.get());

export const updateBubble = (jobId: string, idx: number, patch: Partial<TranslationBubble>) =>
  unwrap<TranslationBubble>(
    api.api.portal.jobs({ id: jobId }).bubbles({ bubbleIndex: String(idx) }).put({
      x: patch.x,
      y: patch.y,
      width: patch.width,
      height: patch.height,
      rotation: patch.rotation,
      source_text: patch.sourceText,
      translated_text: patch.translatedText,
      style_json: patch.styleJson,
    }),
  );

export const deleteBubble = (jobId: string, idx: number) =>
  unwrap<{ deleted: number }>(
    api.api.portal.jobs({ id: jobId }).bubbles({ bubbleIndex: String(idx) }).delete(),
  );

export const reocrBubble = (jobId: string, idx: number) =>
  unwrap<{ source_text: string; elapsed_ms: number }>(
    api.api.portal
      .jobs({ id: jobId })
      .bubbles({ bubbleIndex: String(idx) })
      .reocr.post({}),
  );

export const retranslateBubble = (jobId: string, idx: number) =>
  unwrap<{ translated_text: string; elapsed_ms: number }>(
    api.api.portal
      .jobs({ id: jobId })
      .bubbles({ bubbleIndex: String(idx) })
      .retranslate.post({}),
  );

// ── Job actions ───────────────────────────────────────────────────────────────

export const redetectJob = (id: string) =>
  unwrap<{ blocks: TextSegBlock[]; elapsed_ms: number }>(
    api.api.portal.jobs({ id }).redetect.post({}),
  );

export const reocrJob = (id: string) =>
  unwrap<{ processed: number; total: number }>(api.api.portal.jobs({ id }).reocr.post({}));

export const translateJob = (id: string) =>
  unwrap<{ processed: number; total: number }>(api.api.portal.jobs({ id }).translate.post({}));

export const retranslateJob = (id: string) =>
  unwrap<{ processed: number; total: number }>(
    api.api.portal.jobs({ id }).retranslate.post({}),
  );

export const inpaintJob = (id: string) =>
  unwrapVoid(api.api.portal.jobs({ id }).inpaint.post({}));

export const rerenderJob = (id: string) =>
  unwrapVoid(api.api.portal.jobs({ id }).rerender.post({}));

// ── Translate-page pipeline ───────────────────────────────────────────────────

export const submitTranslatePage = (imageBase64: string) =>
  unwrap<{ job_id: string; cached: boolean }>(
    api.api["translate-page"].post({ image: imageBase64 }),
  );

export const getTranslatePageJob = (jobId: string) =>
  unwrap<{ job_id: string; status: string; stage: string; progress: number; error: string | null; result_url: string | null }>(
    api.api["translate-page"]({ id: jobId }).get(),
  );

/** SSE stream — Eden Treaty doesn't model EventSource; use URL directly. */
export const translatePageEvents = (jobId: string) =>
  new EventSource(`/api/translate-page/${jobId}/events`);

// ── Library ───────────────────────────────────────────────────────────────────

export const listVolumes = () =>
  unwrap<Volume[]>(api.api.portal.volumes.get());

export const createVolume = (data: { title: string; cover_path?: string | null }) =>
  unwrap<Volume>(api.api.portal.volumes.post(data));

export const updateVolume = (id: number, data: { title: string; cover_path?: string | null }) =>
  unwrap<Volume>(api.api.portal.volumes({ id: String(id) }).put(data));

export const deleteVolume = (id: number) =>
  unwrap<{ deleted: string }>(api.api.portal.volumes({ id: String(id) }).delete());

export const listChapters = (volumeId?: number) =>
  unwrap<Chapter[]>(
    api.api.portal.chapters.get(
      volumeId !== undefined ? { query: { volume_id: String(volumeId) } } : {},
    ),
  );

interface ChapterBody {
  title: string;
  pages_dir: string;
  volume_id: number;
  sort_order?: number;
}

export const createChapter = (data: Omit<Chapter, "id" | "createdAt" | "updatedAt">) =>
  unwrap<Chapter>(
    api.api.portal.chapters.post({
      title: data.title,
      pages_dir: data.pagesDir,
      volume_id: data.volumeId,
      sort_order: data.sortOrder,
    } satisfies ChapterBody),
  );

export const updateChapter = (
  id: number,
  data: Pick<Chapter, "title" | "pagesDir" | "volumeId"> & Partial<Pick<Chapter, "sortOrder">>,
) =>
  unwrap<Chapter>(
    api.api.portal.chapters({ id: String(id) }).put({
      title: data.title,
      pages_dir: data.pagesDir,
      volume_id: data.volumeId,
      sort_order: data.sortOrder,
    } satisfies ChapterBody),
  );

export const deleteChapter = (id: number) =>
  unwrap<{ deleted: string }>(api.api.portal.chapters({ id: String(id) }).delete());

export const listChapterJobs = (_chapterId: number): Promise<PageTranslationJob[]> =>
  Promise.reject(new Error("chapter-job filtering not yet implemented"));
