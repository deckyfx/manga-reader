/**
 * Typed client for the web-ocr Bun server via Eden Treaty. `Api` comes from the declarations the server
 * emits (`bun run --cwd ../server types:api`), so request and response shapes are checked at build time.
 */
import { treaty } from "@elysiajs/eden";
import type { Api, ManageApi, PageJobEvent, PageLiveEvent, SettingsApi, StudioApi } from "../../server/types/src/api";

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

// ── Chapter import: the P3 workspace routes ──────────────────────────────────

/**
 * `/api/settings` and `/studio/api` are mounted separately on the server, so they need their own clients. Same
 * transport as everything else: the API key, and no redirects.
 */
const settingsApi = (serverUrl: string, apiKey: string) =>
  treaty<SettingsApi>(serverUrl.replace(/\/$/, ""), { headers: apiKey ? { "x-api-key": apiKey } : {}, fetcher: keyedFetch });

const studioApi = (serverUrl: string, apiKey: string) =>
  treaty<StudioApi>(serverUrl.replace(/\/$/, ""), { headers: apiKey ? { "x-api-key": apiKey } : {}, fetcher: keyedFetch });

/** A workspace as the server lists it; only the fields the import needs. */
export interface WorkspaceRef {
  id: number;
  name: string;
  pages: number;
  next_index: number;
  source_url: string | null;
}

/**
 * Whether this server understands workspaces. An older one has no `capabilities` block at all, so the popup can say
 * "update the server" instead of starting an import that would fail halfway through.
 */
export async function serverHasWorkspaces(serverUrl: string, apiKey: string): Promise<boolean> {
  const { data, error } = await settingsApi(serverUrl, apiKey).api.settings.get();
  if (error) throw new Error(errorMessage(error));
  return (data as { capabilities?: { workspaces?: boolean } }).capabilities?.workspaces === true;
}

/** The workspace an earlier import of this same address made, so the popup can offer to add to it. */
export async function findWorkspaceBySource(serverUrl: string, apiKey: string, sourceUrl: string): Promise<WorkspaceRef | null> {
  const { data, error } = await studioApi(serverUrl, apiKey).studio.api.workspaces.get({ query: { source_url: sourceUrl } });
  if (error) throw new Error(errorMessage(error));
  return data[0] ?? null;
}

export async function createWorkspace(
  serverUrl: string,
  apiKey: string,
  body: { name: string; source_url: string; source_provider: string; adult?: boolean },
): Promise<WorkspaceRef> {
  const { data, error } = await studioApi(serverUrl, apiKey).studio.api.workspaces.post(body);
  if (error) throw new Error(errorMessage(error));
  return data;
}

/** What one uploaded batch did: pages stored, positions that already held one, and anything refused. */
export interface UploadReport {
  imported: number;
  existing: number[];
  skipped: { name: string; index: number; reason: string }[];
}

/**
 * Sends one batch of downloaded images, telling the server where in the chapter they belong. A batch sent again
 * after a dropped connection lands on positions that already hold a page, and the server skips those rather than
 * duplicating them — which is what makes a retry safe.
 */
export async function uploadWorkspacePages(
  serverUrl: string,
  apiKey: string,
  workspaceId: number,
  startIndex: number,
  files: File[],
  sources: string[],
): Promise<UploadReport> {
  const { data, error } = await studioApi(serverUrl, apiKey)
    .studio.api.workspaces({ id: workspaceId })
    .pages.post({ files, start_index: startIndex, sources });
  if (error) throw new Error(errorMessage(error));
  return { imported: data.imported, existing: data.existing, skipped: data.skipped };
}

/**
 * The image addresses a workspace already holds. An import that adds to an earlier one skips these, so running the
 * same chapter twice extends it with what is new instead of appending a second copy of everything.
 */
export async function workspacePageSources(serverUrl: string, apiKey: string, workspaceId: number): Promise<Set<string>> {
  const { data, error } = await studioApi(serverUrl, apiKey).studio.api.workspaces({ id: workspaceId }).get();
  if (error) throw new Error(errorMessage(error));
  return new Set(data.pages.map((page) => page.source));
}

/** Starts "Run all" on the workspace; a run already going answers 409, which is not a failure worth reporting. */
export async function startWorkspaceRun(serverUrl: string, apiKey: string, workspaceId: number): Promise<void> {
  const { error } = await studioApi(serverUrl, apiKey).studio.api.workspaces({ id: workspaceId }).run.post({});
  if (error && error.status !== 409) throw new Error(errorMessage(error));
}

// ── New series from a page: the /manage/api library routes ───────────────────

const manageApi = (serverUrl: string, apiKey: string) =>
  treaty<ManageApi>(serverUrl.replace(/\/$/, ""), { headers: apiKey ? { "x-api-key": apiKey } : {}, fetcher: keyedFetch });

/** Makes the series and answers with its id, so the popup can offer to open it. */
export async function createSeries(
  serverUrl: string,
  apiKey: string,
  body: { title: string; synopsis?: string; adult?: boolean },
): Promise<{ id: number; title: string }> {
  const { data, error } = await manageApi(serverUrl, apiKey).manage.api.series.post(body);
  if (error) throw new Error(errorMessage(error));
  return { id: data.series.id, title: data.series.title };
}

/**
 * Puts a cover on it. The image is downloaded in the worker rather than the popup: the popup closes the moment the
 * user looks away, and a download that outlives it belongs to the worker — the rule chapter images already follow.
 */
export async function addSeriesCover(serverUrl: string, apiKey: string, seriesId: number, cover: File): Promise<void> {
  const { error } = await manageApi(serverUrl, apiKey).manage.api.series({ id: seriesId }).covers.post({ cover });
  if (error) throw new Error(errorMessage(error));
}
