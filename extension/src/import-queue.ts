/**
 * Importing a chapter into a Studio workspace, from the background worker.
 *
 * The worker sleeps when idle, so the whole job lives in `chrome.storage.session` and every step writes it back: a
 * woken worker picks up where it stopped instead of starting the chapter again. The server's own idempotency is the
 * other half of that — a batch uploaded twice lands on positions that already hold a page and is skipped — so a
 * resume that repeats the last batch costs nothing.
 *
 * Each page travels on its own — resolved (for a gallery), downloaded, uploaded — with up to five in flight, so the
 * first pages are in the Studio and translating while the rest are still being read, and nothing waits for the whole
 * chapter. Requests to the *site* are paced by the provider's `minIntervalMs`, one clock for the lot: the image
 * servers a gallery points at are a separate matter, bounded only by the five in flight. A problem that would fail
 * every page after it (the server gone, the gallery tab closed, the site's image limit) pauses the import instead of
 * failing pages, and Try again carries on from the first page not yet in.
 */
import { addSeriesCover, createSeries, createWorkspace, findWorkspaceBySource, serverHasWorkspaces, startWorkspaceRun, uploadWorkspacePages, workspacePageSources } from "./api";
import { isPrivateHost } from "../../server/src/shared/private-host";
import { ensureContentScript } from "./inject";
import { loadServerAccess } from "./settings-store";
import type { Resolved } from "../../server/src/shared/providers/types";
import type { CreateSeriesRequest, ImportRequest, ResolvePageMsg } from "./types";

/** Where one page of the chapter got to. */
export interface ImportPage {
  /** Position in the workspace, 0-based; the server stores it as `sortOrder` + 1. */
  index: number;
  url: string;
  state: "pending" | "uploaded" | "failed";
  reason?: string;
}

export interface ImportJob {
  workspaceId: number;
  workspaceName: string;
  /** The chapter page the images came from, which is also how a later import finds this workspace again. */
  sourceUrl: string;
  provider: string;
  minIntervalMs: number;
  /** Translate the pages as they land. */
  runAfter: boolean;
  /** The pages are a gallery's, each resolved to its image by the tab before it can be downloaded. */
  resolves: boolean;
  /** The tab that resolves them, with the user's cookies. */
  tabId: number;
  pages: ImportPage[];
  startedAt: number;
  finishedAt?: number;
  /** Why the import stopped early; a per-page failure lives on the page instead. */
  error?: string;
}

/** What the popup shows while an import runs. */
export interface ImportStatus {
  job: ImportJob | null;
  done: number;
  failed: number;
  total: number;
  running: boolean;
}

const JOB_KEY = "chapter-import";
/** Pages in flight at once. Enough to hide each page's latency; the site's pace is kept by its clock, not by this. */
const PIPELINE_WIDTH = 5;
/** The server refuses anything larger, so there is no point sending it. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Goes at one image before it is called failed. */
const DOWNLOAD_ATTEMPTS = 3;
/** First backoff between goes; it doubles from there. */
const RETRY_BACKOFF_MS = 700;

/** True while this worker is inside the loop, so a second call doesn't run the same job twice. */
let working = false;
/**
 * When the last paced request to the site started. One clock for every request that counts against the site's limit,
 * and only those: an unpaced download from a gallery's image servers never moves it, or each one would push back the
 * next page read.
 */
let siteLastAt = 0;

/** Waits for the next slot at the site's pace. The slot is taken before the wait, so callers arriving together queue. */
async function takeSiteSlot(minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, siteLastAt + minIntervalMs);
  siteLastAt = startAt;
  if (startAt > now) await delay(startAt - now);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadJob(): Promise<ImportJob | null> {
  const stored = await chrome.storage.session.get(JOB_KEY);
  return (stored[JOB_KEY] as ImportJob | undefined) ?? null;
}

async function saveJob(job: ImportJob | null): Promise<void> {
  if (job) await chrome.storage.session.set({ [JOB_KEY]: job });
  else await chrome.storage.session.remove(JOB_KEY);
}

/** `12/25` while it runs, cleared when it ends. */
function showBadge(job: ImportJob | null): void {
  if (!job || job.finishedAt) {
    void chrome.action.setBadgeText({ text: "" });
    return;
  }
  const settled = job.pages.filter((page) => page.state !== "pending").length;
  void chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
  void chrome.action.setBadgeText({ text: `${settled}/${job.pages.length}` });
}

export function importStatus(job: ImportJob | null): ImportStatus {
  const pages = job?.pages ?? [];
  return {
    job,
    done: pages.filter((page) => page.state === "uploaded").length,
    failed: pages.filter((page) => page.state === "failed").length,
    total: pages.length,
    running: working,
  };
}

/** The current import, for the popup. */
export async function currentImport(): Promise<ImportStatus> {
  return importStatus(await loadJob());
}

/** Forgets a finished import, so the popup offers a fresh one. */
export async function clearImport(): Promise<void> {
  if (working) throw new Error("an import is still running");
  await saveJob(null);
  showBadge(null);
}

/** A failure worth another go: the network dropped, or the CDN is rate-limiting or briefly broken. */
class Transient extends Error {}

/**
 * Refuses a cover address that points inside the network the browser sits on.
 *
 * The address comes from `og:image` on whatever page the user is looking at, and the worker fetches it with the
 * extension's own reach — which includes the user's machine and their LAN. A page can already make a browser
 * *request* those, but it cannot read the answer; this would, and would then upload it to the server. So a cover is
 * only ever fetched from a public address.
 *
 * Only literal addresses can be checked here: a name that resolves to a private one gets through, because the
 * extension has no resolver. That is the limit the server's own image fetch closes with DNS pinning, and it is
 * worth saying rather than implying this is airtight.
 */
function coverMustBePublic(cover: string): void {
  let url: URL;
  try {
    url = new URL(cover);
  } catch {
    throw new Error("that isn't an address a cover can be fetched from");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`a cover can't be fetched over ${url.protocol}`);
  if (isPrivateHost(url.hostname)) throw new Error("the cover points inside your own network, so it wasn't fetched");
}

/**
 * Makes a series out of what a page says about itself, and puts its cover on when it has one.
 *
 * The cover is downloaded here rather than in the popup for the reason every other download lives here: the popup
 * closes as soon as the user looks away, and a half-finished upload would go with it. A cover that won't download
 * is not worth failing over — the series is made either way, and a cover can be added by hand afterwards.
 */
export async function createSeriesFromPage(request: CreateSeriesRequest): Promise<{ id: number; title: string; coverError?: string }> {
  const { serverUrl, apiKey } = await loadServerAccess();
  if (!serverUrl) throw new Error("no server address is set — open the options page");

  const series = await createSeries(serverUrl, apiKey, {
    title: request.title,
    ...(request.synopsis ? { synopsis: request.synopsis } : {}),
    adult: request.adult,
  });

  if (!request.cover) return series;
  try {
    coverMustBePublic(request.cover);
    const file = await fetchPage(request.cover, 0);
    await addSeriesCover(serverUrl, apiKey, series.id, file);
    return series;
  } catch (err) {
    return { ...series, coverError: err instanceof Error ? err.message : String(err) };
  }
}

/** One attempt at one image. Throws `Transient` when trying again might work. */
async function fetchPage(url: string, minIntervalMs: number): Promise<File> {
  // Paced only when this request counts against the site's limit; a gallery's image servers pass 0
  if (minIntervalMs > 0) await takeSiteSlot(minIntervalMs);

  // No spoofed headers: rawkuma's CDN serves without a Referer, and anything that needs one gets its own rule later
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", cache: "no-store" });
  } catch (err) {
    // A dropped connection says nothing about the image itself
    throw new Transient(err instanceof Error ? err.message : String(err));
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new Transient(`the site answered ${response.status}`);
  }
  if (!response.ok) throw new Error(`the site answered ${response.status}`);

  const blob = await response.blob();
  if (blob.size === 0) throw new Transient("the site sent an empty file");
  // These two are about the image, not the moment: another go would fetch the same thing
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("image too large (max 15 MB)");
  if (blob.type && !blob.type.startsWith("image/")) throw new Error(`not an image (${blob.type})`);

  const name = new URL(url).pathname.split("/").filter(Boolean).pop() || "page.jpg";
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

/**
 * One image, with a few goes at it. A CDN that hiccups on page 12 of 25 shouldn't cost the page: the attempts back
 * off, and only a lasting failure — or one that says the image itself is wrong — gives up.
 */
async function downloadPage(url: string, minIntervalMs: number): Promise<File> {
  let lastError: Error = new Error("download failed");
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      return await fetchPage(url, minIntervalMs);
    } catch (err) {
      if (!(err instanceof Transient)) throw err;
      lastError = err;
      if (attempt < DOWNLOAD_ATTEMPTS - 1) await delay(RETRY_BACKOFF_MS * 2 ** attempt);
    }
  }
  throw new Error(`${lastError.message} (after ${DOWNLOAD_ATTEMPTS} attempts)`);
}

/**
 * Something that would fail every page after this one, too: the server is unreachable, the gallery tab has gone, the
 * site's image limit is spent. The import stops taking new pages and pauses — the page stays pending, not failed, so
 * Try again picks it up.
 */
class Pause extends Error {}

/**
 * One gallery page to its image, asked of the tab that holds the user's cookies. Counts against the site's pace.
 */
async function resolveImage(job: ImportJob, page: ImportPage): Promise<string> {
  try {
    // The tab may have been reloaded since the import started, which takes the content script with it
    await ensureContentScript(job.tabId);
  } catch {
    throw new Pause("the gallery tab is closed or can't be read — reopen the gallery and press Try again");
  }
  await takeSiteSlot(job.minIntervalMs);
  let resolved: Resolved | undefined;
  try {
    resolved = await chrome.tabs.sendMessage(job.tabId, { type: "resolve-page", provider: job.provider, page: page.url } satisfies ResolvePageMsg) as Resolved | undefined;
  } catch {
    resolved = undefined;
  }
  if (!resolved) throw new Pause("the gallery tab stopped answering — reopen the gallery and press Try again");
  if (resolved.ok) return resolved.url;
  if (resolved.stop) throw new Pause(resolved.reason);
  // Only this page: an odd page shouldn't halt the gallery
  throw new Error(resolved.reason);
}

/** The page's image as a file: resolved first for a gallery, whose image servers aren't paced; downloaded at the site's pace otherwise. */
async function pageImage(job: ImportJob, page: ImportPage): Promise<File> {
  if (!job.resolves) return downloadPage(page.url, job.minIntervalMs);
  return downloadPage(await resolveImage(job, page), 0);
}

/**
 * Sends one page to its position. A server that can't be reached is a pause, not a failed page: it will be the same
 * for every page after this one. A position that already holds a page (a resumed import) counts as done.
 */
async function uploadOne(job: ImportJob, page: ImportPage, file: File, access: { serverUrl: string; apiKey: string }): Promise<void> {
  let refused: { reason: string } | undefined;
  try {
    const report = await uploadWorkspacePages(access.serverUrl, access.apiKey, job.workspaceId, page.index, [file], [page.url]);
    refused = report.skipped.find((entry) => entry.index === page.index);
  } catch (err) {
    throw new Pause(`the server didn't take page ${page.index + 1}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (refused) {
    page.state = "failed";
    page.reason = refused.reason;
  } else {
    page.state = "uploaded";
  }
}

/**
 * Makes sure a translation run is going. Asked after every upload rather than once: a run follows the workspace, so
 * one already going answers 409 and picks the page up itself, and one that ran out of pages before this one landed is
 * started again. Never awaited by the pipeline — translating is the server's pace, not this one's.
 */
async function keepRunGoing(job: ImportJob, access: { serverUrl: string; apiKey: string }): Promise<void> {
  if (!job.runAfter) return;
  await startWorkspaceRun(access.serverUrl, access.apiKey, job.workspaceId).catch(() => {
    // A run that won't start doesn't undo an import that did: the Studio's own button is still there
  });
}

/**
 * Takes every pending page through resolve → download → upload, PIPELINE_WIDTH at a time, in reading order. Safe to
 * call again: it only ever takes pending pages, so a resume carries on from the first one not yet in.
 */
async function processJob(): Promise<void> {
  if (working) return;
  working = true;
  const job = await loadJob();
  try {
    if (!job || job.finishedAt) return;
    const access = await loadServerAccess();
    const queue = job.pages.filter((page) => page.state === "pending");
    let cursor = 0;
    let paused: string | null = null;

    // Workers share one cursor, so pages are taken in order; a pause stops anyone taking another
    const worker = async (): Promise<void> => {
      while (paused === null && cursor < queue.length) {
        const page = queue[cursor++]!;
        try {
          const file = await pageImage(job, page);
          await uploadOne(job, page, file, access);
          if (page.state === "uploaded") void keepRunGoing(job, access);
        } catch (err) {
          if (err instanceof Pause) {
            paused ??= err.message;
          } else {
            page.state = "failed";
            page.reason = err instanceof Error ? err.message : String(err);
          }
        }
        await saveJob(job);
        showBadge(job);
      }
    };
    await Promise.all(Array.from({ length: PIPELINE_WIDTH }, worker));

    if (paused !== null) {
      // Left unfinished on purpose: pending pages stay pending, and Try again or the next wake carries on
      job.error = paused;
    } else {
      job.finishedAt = Date.now();
      // Once more at the end: any page that landed after a run ran out gets one
      await keepRunGoing(job, access);
    }
    await saveJob(job);
    showBadge(job);
  } catch (err) {
    if (job) {
      job.error = err instanceof Error ? err.message : String(err);
      await saveJob(job);
      showBadge(job);
    }
  } finally {
    working = false;
  }
}

/**
 * Starts an import: finds or creates the workspace, writes the job down, and begins. Returns once the job exists, so
 * the popup can show progress immediately; the work carries on in the worker.
 */
export async function startChapterImport(request: ImportRequest): Promise<ImportJob> {
  const existing = await loadJob();
  if (existing && !existing.finishedAt) throw new Error("an import is already running");
  if (request.images.length === 0) throw new Error("no pages to import");

  const access = await loadServerAccess();
  if (!access.serverUrl) throw new Error("set the server address in the extension's settings first");
  if (!access.apiKey) throw new Error("this server needs an API key — add one in the extension's settings");
  if (!(await serverHasWorkspaces(access.serverUrl, access.apiKey))) {
    throw new Error("this server is too old to import chapters — update it");
  }

  // An earlier import of the same chapter is extended rather than duplicated
  const target = request.workspaceId !== undefined
    ? await findWorkspaceBySource(access.serverUrl, access.apiKey, request.sourceUrl)
    : null;
  const reusing = target !== null && target.id === request.workspaceId;
  const workspace = reusing && target
    ? target
    : await createWorkspace(access.serverUrl, access.apiKey, {
        name: request.name,
        source_url: request.sourceUrl,
        source_provider: request.provider,
        ...(request.adult !== undefined ? { adult: request.adult } : {}),
      });

  // Adding to an earlier import: whatever it already holds is left alone, so the same chapter twice extends it
  // rather than appending a second copy of every page
  const already = reusing ? await workspacePageSources(access.serverUrl, access.apiKey, workspace.id).catch(() => new Set<string>()) : new Set<string>();
  // Deduplicated in reading order: an extractor can hand back the same address twice (a noscript fallback listing
  // it again, a reader repeating a page), and each copy would otherwise become its own page of the chapter
  const seen = new Set<string>();
  const images: string[] = [];
  for (const url of request.images) {
    if (already.has(url) || seen.has(url)) continue;
    seen.add(url);
    images.push(url);
  }
  if (images.length === 0) throw new Error("every page of this chapter is already in that workspace");

  const job: ImportJob = {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    sourceUrl: request.sourceUrl,
    provider: request.provider,
    minIntervalMs: request.minIntervalMs,
    runAfter: request.runAfter,
    resolves: request.resolves,
    tabId: request.tabId,
    // Appended after whatever the workspace already holds, so adding to an earlier import doesn't overwrite it
    pages: images.map((url, offset) => ({ index: (workspace.next_index ?? 0) + offset, url, state: "pending" as const })),
    startedAt: Date.now(),
  };
  await saveJob(job);
  showBadge(job);
  void processJob();
  return job;
}

/** Tries a stalled import again, after the network or the server came back. */
export async function retryChapterImport(): Promise<void> {
  const job = await loadJob();
  if (!job || job.finishedAt) return;
  delete job.error;
  await saveJob(job);
  void processJob();
}

/** Picks up an import the worker was in the middle of when it went to sleep. */
export async function resumeChapterImport(): Promise<void> {
  const job = await loadJob();
  if (!job || job.finishedAt) return;
  showBadge(job);
  void processJob();
}
