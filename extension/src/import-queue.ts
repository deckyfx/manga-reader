/**
 * Importing a chapter into a Studio workspace, from the background worker.
 *
 * The worker sleeps when idle, so the whole job lives in `chrome.storage.session` and every step writes it back: a
 * woken worker picks up where it stopped instead of starting the chapter again. The server's own idempotency is the
 * other half of that — a batch uploaded twice lands on positions that already hold a page and is skipped — so a
 * resume that repeats the last batch costs nothing.
 *
 * Downloads are paced by the provider's `minIntervalMs` and run two at a time; pages are uploaded in small batches as
 * they arrive, so the Studio shows progress early and the worker never holds a whole chapter in memory.
 */
import { createWorkspace, findWorkspaceBySource, serverHasWorkspaces, startWorkspaceRun, uploadWorkspacePages, workspacePageSources } from "./api";
import { loadServerAccess } from "./settings-store";
import type { ImportRequest } from "./types";

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
  /** Start "Run all" once every page is in. */
  runAfter: boolean;
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
/** Pages uploaded per request: small enough that the Studio fills in early, large enough to avoid a request each. */
const BATCH_SIZE = 5;
/** Two at a time is polite to a CDN and still hides most of the latency. */
const PARALLEL_DOWNLOADS = 2;
/** The server refuses anything larger, so there is no point sending it. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Goes at one image before it is called failed. */
const DOWNLOAD_ATTEMPTS = 3;
/** First backoff between goes; it doubles from there. */
const RETRY_BACKOFF_MS = 700;

/** True while this worker is inside the loop, so a second call doesn't run the same job twice. */
let working = false;
/** When the last download was *started*, for the provider's pacing. */
let lastRequestAt = 0;

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

/** One attempt at one image. Throws `Transient` when trying again might work. */
async function fetchPage(url: string, minIntervalMs: number): Promise<File> {
  // The slot is taken before waiting for it: two callers arriving together would otherwise compute the same wait
  // and start at the same moment, which is the one thing the interval exists to prevent
  const now = Date.now();
  const startAt = Math.max(now, lastRequestAt + minIntervalMs);
  lastRequestAt = startAt;
  if (startAt > now) await delay(startAt - now);

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
 * Sends the pages that are ready, in runs of neighbouring positions. Runs matter: the server places a batch at
 * `start_index`, `start_index + 1`, … so a gap left by a failed page has to end the batch rather than shift
 * everything after it up by one.
 */
async function uploadReady(
  job: ImportJob,
  ready: Map<number, { file: File; url: string }>,
  access: { serverUrl: string; apiKey: string },
): Promise<void> {
  while (ready.size > 0) {
    const first = Math.min(...ready.keys());
    const run: { index: number; file: File; url: string }[] = [];
    for (let index = first; ready.has(index) && run.length < BATCH_SIZE; index++) {
      const entry = ready.get(index)!;
      run.push({ index, ...entry });
    }

    try {
      const report = await uploadWorkspacePages(
        access.serverUrl,
        access.apiKey,
        job.workspaceId,
        run[0]!.index,
        run.map((entry) => entry.file),
        run.map((entry) => entry.url),
      );
      for (const entry of run) {
        const page = job.pages.find((candidate) => candidate.index === entry.index);
        if (page) page.state = "uploaded";
        ready.delete(entry.index);
      }
      // The server reports a refusal by the position it was given, which is the page's index, not its place in the array
      for (const skipped of report.skipped) {
        const page = job.pages.find((candidate) => candidate.index === skipped.index);
        if (page) {
          page.state = "failed";
          page.reason = skipped.reason;
        }
      }
    } catch (err) {
      // The batch stays in `ready`: the next pass tries it again, and the server skips whatever did land
      throw err instanceof Error ? err : new Error(String(err));
    }
    await saveJob(job);
    showBadge(job);
  }
}

/** Downloads and uploads everything still pending. Safe to call again: it only ever works on `pending` pages. */
async function processJob(): Promise<void> {
  if (working) return;
  working = true;
  try {
    const access = await loadServerAccess();
    const job = await loadJob();
    while (job && !job.finishedAt) {
      const pending = job.pages.filter((page) => page.state === "pending");
      if (pending.length === 0) break;

      // A slice at a time, so a long chapter checkpoints as it goes instead of holding everything until the end
      const slice = pending.slice(0, BATCH_SIZE * 2);
      const ready = new Map<number, { file: File; url: string }>();
      for (let i = 0; i < slice.length; i += PARALLEL_DOWNLOADS) {
        const group = slice.slice(i, i + PARALLEL_DOWNLOADS);
        await Promise.all(group.map(async (page) => {
          try {
            ready.set(page.index, { file: await downloadPage(page.url, job.minIntervalMs), url: page.url });
          } catch (err) {
            page.state = "failed";
            page.reason = err instanceof Error ? err.message : String(err);
          }
        }));
        await saveJob(job);
        showBadge(job);
      }

      // Everything this slice managed to download goes now: there is nothing left to wait for
      await uploadReady(job, ready, access);
    }

    if (job && !job.finishedAt) {
      job.finishedAt = Date.now();
      await saveJob(job);
      if (job.runAfter && job.pages.some((page) => page.state === "uploaded")) {
        await startWorkspaceRun(access.serverUrl, access.apiKey, job.workspaceId).catch(() => {
          // A run that won't start doesn't undo an import that did: the Studio's own button is still there
        });
      }
      showBadge(job);
    }
  } catch (err) {
    // Left unfinished on purpose: the pages already downloaded are still pending, and the job is written down, so
    // the next wake — or the popup's "Try again" — carries on rather than abandoning a half-imported chapter
    const job = await loadJob();
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
