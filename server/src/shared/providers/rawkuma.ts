/**
 * rawkuma.net readers.
 *
 * A thin wrapper over the generic extractor with a fixed reader selector: the pages are plain `<img>` tags inside the
 * reader, all present in the HTML (a 2026-09-18 probe found 25 without running any JavaScript). Looking only inside
 * the reader means a layout change breaks loudly — no images, so the popup says so — instead of quietly importing the
 * sidebar's thumbnails.
 *
 * Re-checked live on 2026-09-22: the site moved to a new theme. The pages now sit in `<section data-image-data>`
 * (23 plain `src` images for chapter 17.1 of a sample series, still all in the HTML) on a new image host,
 * kuma.kyut.dev, which serves with no Referer, the site's, or a wrong one. The page has no og:title any more, so the
 * title comes from `<title>`: "<Series> Chapter 17.1 – Rawkuma".
 */
import { chapterOf, collectCandidates, largestGroup, titleOf } from "./generic";
import type { ChapterExtract, ExtractContext, Extractor } from "./types";

/** Where the pages live, newest theme first. More than one, because the theme has been changed before. */
const READER_SELECTORS = ["[data-image-data]", "#readerarea", ".reading-content", "#chapter_body"] as const;

/** `rawkuma.net/manga/<slug>/chapter-<n>.<id>/`, with or without `www`. */
function matches(url: URL): boolean {
  if (!/(^|\.)rawkuma\.net$/i.test(url.hostname)) return false;
  return /\/manga\/[^/]+\/chapter-/i.test(url.pathname);
}

/**
 * The series name from a chapter's title, which reads "<Series> Chapter 17.1 – Rawkuma": the site's name and the
 * chapter are dropped, since the chapter number is reported separately and the popup adds it back once.
 */
export function seriesTitle(title: string): string {
  return title
    .replace(/\s*[–—|-]\s*rawkuma\s*$/i, "")
    .replace(/\s+(?:chapter|ch\.?)\s*[\d.]+\s*$/i, "")
    .trim();
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

    const full = titleOf(ctx.document);
    const title = full === undefined ? undefined : seriesTitle(full) || full;
    const chapter = chapterNumber(ctx.url);
    return Promise.resolve({
      images,
      ...(title !== undefined ? { title } : {}),
      ...(chapter !== undefined ? { chapter } : {}),
    });
  },
};
