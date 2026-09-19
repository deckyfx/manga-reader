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
    fetcher: keyedFetch,
  });
}

/**
 * The transport every server call goes through, redirects refused.
 *
 * `fetch` follows a redirect by default and keeps custom headers when it does — including a cross-origin one — so a
 * server or proxy answering with a 3xx elsewhere would receive the API key. Nothing this extension talks to has a
 * reason to redirect, so a redirect is an error. It is set here, after whatever the caller passed, so a per-call
 * option can't switch it back on.
 */
const keyedFetch: typeof fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: "error" }),
  { preconnect: fetch.preconnect },
);

/**
 * EventSource can't send headers, so a progress stream has to carry its credential in the URL — and a URL ends up in
 * logs and history. The server hands out a token for exactly that: minutes long, streams only, and never the API key.
 */
export async function streamUrl(serverUrl: string, path: string, apiKey: string): Promise<string> {
  const base = serverUrl.replace(/\/$/, "");
  const { data, error } = await serverApi(base, apiKey).api["stream-token"].post();
  if (error) throw new Error(errorMessage(error));
  const url = new URL(path, base + "/");
  url.searchParams.set("stream_token", data.token);
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
