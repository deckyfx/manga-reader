/**
 * Typed client for the web-ocr Bun server via Eden Treaty. `Api` comes from the declarations the server
 * emits (`bun run --cwd ../server types:api`), so request and response shapes are checked at build time.
 */
import { treaty } from "@elysiajs/eden";
import type { Api, PageJobEvent, PageLiveEvent } from "../../server/types/src/api";

export type { PageJobEvent, PageLiveEvent };

/**
 * The server's routes are closed: OCR, translation, the dictionary and page jobs all want an API key, made on the
 * server's own /user page and pasted into the options here.
 */
export function serverApi(serverUrl: string, apiKey = "") {
  return treaty<Api>(serverUrl.replace(/\/$/, ""), {
    headers: apiKey ? { "x-api-key": apiKey } : {},
  });
}

/**
 * EventSource can't send headers, so the progress streams take the key in the query. The server accepts it there for
 * those two paths only, and keeps it out of its log.
 */
export function streamUrl(serverUrl: string, path: string, apiKey = ""): string {
  const url = new URL(path, serverUrl.replace(/\/$/, "") + "/");
  if (apiKey) url.searchParams.set("api_key", apiKey);
  return url.toString();
}

/** Readable message from an Eden error: the server's `{ error }` body, a validation message, or the status. */
export function errorMessage(error: { status: unknown; value: unknown }): string {
  const value = error.value;
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object") {
    const body = value as { error?: unknown; message?: unknown; summary?: unknown };
    for (const field of [body.error, body.summary, body.message]) {
      if (typeof field === "string" && field) return field;
    }
  }
  return `Server error ${String(error.status)}`;
}
