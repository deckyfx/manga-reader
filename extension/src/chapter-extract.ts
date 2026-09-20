/**
 * Reading a chapter's page addresses off the page the user is looking at.
 *
 * This runs in the content script because only there is the DOM the real one: lazy attributes resolved, the reader's
 * own scripts finished, the user's session applied. The extractors themselves are shared with the server
 * (`shared/providers/`), so the same code the fixtures test is the code that runs here.
 */
import { extractorFor } from "../../server/src/shared/providers/registry";
import type { ExtractContext } from "../../server/src/shared/providers/types";

/** What the popup gets back: enough to show the find and to start an import from it. */
export type ChapterExtractResult =
  | {
      ok: true;
      /** Extractor id, stored on the workspace as `sourceProvider`. */
      provider: string;
      label: string;
      minIntervalMs: number;
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
async function fetchDocument(url: string): Promise<Document> {
  const response = await fetch(url, { credentials: "include" });
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
    const ctx: ExtractContext = { url, document, fetchDocument, log: (message) => logs.push(message) };

    let extract = await extractor.extract(ctx);
    if (rescan || extract.images.length === 0) {
      await scrollThroughPage((message) => logs.push(message));
      extract = await extractor.extract(ctx);
    }

    return {
      ok: true,
      provider: extractor.id,
      label: extractor.label,
      minIntervalMs: extractor.minIntervalMs,
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
