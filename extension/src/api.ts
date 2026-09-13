/**
 * Typed client for the web-ocr Bun server via Eden Treaty. `Api` comes from the declarations the server
 * emits (`bun run --cwd ../server-bun types:api`), so request and response shapes are checked at build time.
 */
import { treaty } from "@elysiajs/eden";
import type { Api, PageJobEvent } from "../../server-bun/types/src/api";

export type { PageJobEvent };

export function serverApi(serverUrl: string) {
  return treaty<Api>(serverUrl.replace(/\/$/, ""));
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
