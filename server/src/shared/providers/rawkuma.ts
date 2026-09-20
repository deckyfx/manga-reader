/**
 * rawkuma.net readers.
 *
 * A thin wrapper over the generic extractor with a fixed reader selector: the pages are plain `<img>` tags inside the
 * reader, all present in the HTML (a 2026-09-18 probe found 25 without running any JavaScript). Looking only inside
 * the reader means a layout change breaks loudly — no images, so the popup says so — instead of quietly importing the
 * sidebar's thumbnails.
 */
import { chapterOf, collectCandidates, largestGroup, titleOf } from "./generic";
import type { ChapterExtract, ExtractContext, Extractor } from "./types";

/** Where the pages live. More than one, because the theme has been renamed before. */
const READER_SELECTORS = ["#readerarea", ".reading-content", "#chapter_body"] as const;

/** `rawkuma.net/manga/<slug>/chapter-<n>.<id>/`, with or without `www`. */
function matches(url: URL): boolean {
  if (!/(^|\.)rawkuma\.net$/i.test(url.hostname)) return false;
  return /\/manga\/[^/]+\/chapter-/i.test(url.pathname);
}

/**
 * The chapter number, which here is followed by the site's post id: `chapter-14.12345` is chapter 14, not 14.12345.
 * A run of four or more digits is that id; a real decimal chapter ("14.5") is one or two. Without an id the generic
 * rule answers, so `chapter-2.9` still reads as 2.9.
 */
function chapterNumber(url: URL): string | undefined {
  const withPostId = /\/chapter-(\d+(?:\.\d{1,2})?)\.\d{4,}/i.exec(url.pathname);
  return withPostId?.[1] ?? chapterOf(url);
}

export const rawkumaExtractor: Extractor = {
  id: "rawkuma",
  label: "Rawkuma",
  matches,
  // The images come from one CDN that has been happy with a modest pace
  minIntervalMs: 400,

  extract(ctx: ExtractContext): Promise<ChapterExtract> {
    const reader = READER_SELECTORS.map((selector) => ctx.document.querySelector(selector)).find((node) => node !== null);
    if (!reader) {
      ctx.log(`no reader found (looked for ${READER_SELECTORS.join(", ")}) — the site's layout may have changed`);
      return Promise.resolve({ images: [] });
    }

    // Inside the reader the pages are already the only images, so the grouping is just a guard against a stray banner
    const images = largestGroup(collectCandidates(reader, ctx.url));
    ctx.log(`${images.length} page(s) in the reader`);

    const title = titleOf(ctx.document);
    const chapter = chapterNumber(ctx.url);
    return Promise.resolve({
      images,
      ...(title !== undefined ? { title } : {}),
      ...(chapter !== undefined ? { chapter } : {}),
    });
  },
};
