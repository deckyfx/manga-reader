/**
 * Reading a chapter's page addresses off the page the user is looking at.
 *
 * This runs in the content script because only there is the DOM the real one: lazy attributes resolved, the reader's
 * own scripts finished, the user's session applied. The extractors themselves are shared with the server
 * (`shared/providers/`), so the same code the fixtures test is the code that runs here.
 */
import { extractorById, extractorFor } from "../../server/src/shared/providers/registry";
import { seriesInfoFrom, type SeriesInfo } from "../../server/src/shared/providers/series-info";
import type { ExtractContext, Resolved } from "../../server/src/shared/providers/types";
import type { ExtractProgressMsg } from "./types";

/** What a series page says about itself, for "New series from this page". */
export type SeriesExtractResult =
  | { ok: true; info: SeriesInfo }
  | { ok: false; error: string };

/**
 * Reads the open page's own description of itself. No scrolling and no fetching: the metadata sits in the head from
 * the first paint, and a series page has nothing to build up the way a reader's image list does.
 */
export function extractSeriesHere(): SeriesExtractResult {
  try {
    const info = seriesInfoFrom(document, new URL(location.href));
    if (!info) return { ok: false, error: "this page doesn't say what it is — there's no title to start a series from" };
    return { ok: true, info };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** What the popup gets back: enough to show the find and to start an import from it. */
export type ChapterExtractResult =
  | {
      ok: true;
      /** Extractor id, stored on the workspace as `sourceProvider`. */
      provider: string;
      label: string;
      minIntervalMs: number;
      /** The list holds pages rather than images, each resolved by this tab when the import reaches it. */
      resolves: boolean;
      images: string[];
      title?: string;
      chapter?: string;
      adult?: boolean;
      /** What the extractor did, shown when the find looks wrong. */
      logs: string[];
    }
  | { ok: false; error: string };

/** Scroll steps before giving up on a reader that keeps building its list. */
const MAX_SCROLL_STEPS = 40;
/** Long enough for a lazy loader to notice the viewport moved. */
const SCROLL_SETTLE_MS = 250;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same-origin fetch + parse, for readers that spread one chapter over several pages. */
/** Longest a page of a multi-page walk may take. Without a limit one stalled request hung the whole read. */
const FETCH_TIMEOUT_MS = 20_000;

async function fetchDocument(url: string): Promise<Document> {
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

/**
 * Walks the page to the bottom so a reader that loads images as you scroll has a chance to build its list, then puts
 * the scroll position back. The extractor runs again afterwards rather than watching mutations: the page either has
 * more images by the end or it doesn't, and re-reading is simpler than keeping a running collection in step with it.
 */
async function scrollThroughPage(log: (message: string) => void): Promise<void> {
  const startedAt = window.scrollY;
  let previous = document.images.length;
  let settled = 0;

  for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
    window.scrollTo({ top: window.scrollY + window.innerHeight * 0.9, behavior: "instant" });
    await delay(SCROLL_SETTLE_MS);
    const count = document.images.length;
    const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
    // Two quiet steps at the bottom: one alone can just mean the next batch hasn't arrived yet
    if (count === previous && atBottom) {
      if (++settled >= 2) break;
    } else {
      settled = 0;
    }
    previous = count;
  }

  window.scrollTo({ top: startedAt, behavior: "instant" });
  log(`scrolled the page; ${document.images.length} image(s) present afterwards`);
}

/**
 * Runs the extractor that fits this address. `rescan` forces the scroll pass, which is also done automatically when
 * the first read finds nothing — that is the shape of a reader whose images only exist once they scroll into view.
 */
export async function extractChapterHere(rescan = false): Promise<ChapterExtractResult> {
  try {
    const url = new URL(location.href);
    const extractor = extractorFor(url);
    const logs: string[] = [];
    const log = (message: string): void => {
      logs.push(message);
      // Live, to the popup: a gallery walk takes a second a page, and without this the popup sat on its first
      // message for minutes and looked hung. Nobody listening (the popup closed) is not an error.
      chrome.runtime.sendMessage({ type: "extract-progress", message } satisfies ExtractProgressMsg).catch(() => undefined);
    };
    const ctx: ExtractContext = { url, document, fetchDocument, log };

    let extract = await extractor.extract(ctx);
    // A reader that adds pages as you scroll answers the first read with however many exist so far, which is
    // indistinguishable from a complete answer. A site with its own extractor knows where its pages live, so only
    // the generic guess pays the scroll; the cost is seconds on an import, against silently importing half a chapter.
    if (rescan || extract.images.length === 0 || extractor.id === "generic") {
      await scrollThroughPage((message) => logs.push(message));
      extract = await extractor.extract(ctx);
    }

    return {
      ok: true,
      provider: extractor.id,
      label: extractor.label,
      minIntervalMs: extractor.minIntervalMs,
      resolves: extractor.resolve !== undefined,
      images: extract.images,
      ...(extract.title !== undefined ? { title: extract.title } : {}),
      ...(extract.chapter !== undefined ? { chapter: extract.chapter } : {}),
      ...(extract.adult !== undefined ? { adult: extract.adult } : {}),
      logs,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Turns one listed page into its image, for an import in progress. It runs here, in the tab, because this is where the
 * user's cookies are: the worker asks, a page at a time, as it reaches each one. Pacing is the worker's business.
 */
export async function resolvePageHere(provider: string, page: string): Promise<Resolved> {
  const extractor = extractorById(provider);
  if (!extractor?.resolve) return { ok: false, reason: `${provider} has no pages to resolve`, stop: true };
  try {
    const ctx: ExtractContext = { url: new URL(location.href), document, fetchDocument, log: () => undefined };
    return await extractor.resolve(page, ctx);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

