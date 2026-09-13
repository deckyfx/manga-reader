import { treaty } from "@elysiajs/eden";
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

export const updateBlockText = (id: string, idx: number, text: { source_text?: string; translated_text?: string }) =>
  unwrap(api.studio.api.pages({ id }).blocks({ idx }).patch(text));

/** Re-run OCR or translation (for `blockIds`, or every text block) or typeset the page again. */
export const runStage = (id: string, stage: "ocr" | "translate" | "render", blockIds?: number[]) =>
  unwrap(api.studio.api.pages({ id }).run.post({ stage, block_ids: blockIds }));

export const publishPage = (id: string) => unwrap(api.studio.api.pages({ id }).publish.post());

export const listHistory = (id: string) => unwrap(api.studio.api.pages({ id }).history.get());

export const rollbackPage = (id: string, revision: number) =>
  unwrap(api.studio.api.pages({ id }).rollback.post({ revision }));

export const historyImageUrl = (id: string, revision: number) => `/studio/api/pages/${id}/history/${revision}`;

export type StudioPageSummary = Awaited<ReturnType<typeof listPages>>[number];
export type StudioPageDetail = Awaited<ReturnType<typeof getPage>>;
export type StudioBlock = StudioPageDetail["blocks"][number];
export type StudioStage = StudioPageDetail["stages"][number];

/** Images stored per page, in pipeline order. */
export const PAGE_IMAGES = [
  { file: "original.png", label: "Original" },
  { file: "overlay.png", label: "Detection" },
  { file: "clean-text.png", label: "Cleaned text" },
  { file: "clean-sfx.png", label: "Cleaned SFX" },
  { file: "render-overlay.png", label: "Typeset areas" },
  { file: "result.png", label: "Result" },
] as const;

export type PageImage = (typeof PAGE_IMAGES)[number]["file"];

/** URL of a stage image; `version` changes after edits so the browser doesn't show a cached copy. */
export const pageFileUrl = (id: string, file: PageImage, version?: string | number) =>
  `/studio/api/pages/${id}/files/${file}${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ""}`;
