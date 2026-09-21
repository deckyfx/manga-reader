/**
 * exhentai / e-hentai galleries.
 *
 * Unlike a reader, a gallery doesn't hold its images: it holds links to one page each, and the image address only
 * appears on that page. So this extractor walks — the gallery's pager for the list of gallery pages, each of those
 * for its image-page links, and each image page for the image itself. That is `1 + gallery pages + image pages`
 * requests, which is why the interval here is a second and the popup reports progress while it collects.
 *
 * No credentials are stored or asked for: the content script fetches from the site the user is already signed in to,
 * so their own cookies go along. A signed-out visitor gets the "no access" page instead of a gallery, which is
 * reported as such rather than as an empty chapter.
 *
 * The markup this depends on — `#gn`, `#gj`, `/s/<key>/<gid>-<n>` links carrying the gallery's own id, the `?p=`
 * pager, and `#img` holding an absolute H@H address — was checked against live e-hentai galleries on 2026-09-21 (same
 * markup as exhentai, which needs a signed-in browser to fetch). The fixtures pin it, so a redesign fails loudly.
 */
import type { ChapterExtract, ExtractContext, Extractor } from "./types";

/** exhentai has asked for a second between requests for years; the walk is slow by design. */
const MIN_INTERVAL_MS = 1000;
/** A gallery larger than this is almost certainly a mis-parse, and a thousand fetches is not a thing to start. */
const MAX_IMAGE_PAGES = 2000;
/**
 * Gallery pages read in one go. The pager is whatever the page claims it is, and at a second a request a page
 * claiming `?p=99999` would otherwise buy itself a day of this extension's time.
 *
 * Sized so MAX_IMAGE_PAGES is the limit that actually bites: a gallery page lists twenty images by default (checked
 * against a live e-hentai gallery on 2026-09-21 — 64 images over `?p=0..3`), so this many pages covers the full
 * image cap and a real gallery never reaches it first.
 */
const MAX_GALLERY_PAGES = Math.ceil(MAX_IMAGE_PAGES / 20);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `exhentai.org/g/<gid>/<token>/` and the same gallery on e-hentai. */
function matches(url: URL): boolean {
  if (!/(^|\.)(exhentai|e-hentai)\.org$/i.test(url.hostname)) return false;
  return /^\/g\/\d+\/[0-9a-f]+\/?$/i.test(url.pathname);
}

/** Highest `?p=` in the gallery's pager; 0 when a gallery fits on one page. */
function lastPagerIndex(document: Document): number {
  let last = 0;
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='?p=']"))) {
    const match = /[?&]p=(\d+)/.exec(link.getAttribute("href") ?? "");
    const index = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
    if (Number.isInteger(index) && index > last) last = index;
  }
  return last;
}

/** The gallery's own id, from `/g/<gid>/<token>/`. */
function galleryId(base: URL): string | null {
  return /^\/g\/(\d+)\//.exec(base.pathname)?.[1] ?? null;
}

/**
 * The image-page links on one gallery page, in order, as absolute addresses.
 *
 * A link counts only if it is this site's, and this gallery's: the page is a page of someone else's site as far as
 * this code is concerned, and a stray `/s/` link — another gallery in a comment, a mirror on another host — would
 * otherwise be walked and its images imported into the reader's chapter.
 */
function imagePageLinks(document: Document, base: URL): string[] {
  const gid = galleryId(base);
  const links: string[] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    // Anchored, so `/elsewhere/s/abc/1-1` doesn't pass for an image page
    const path = /^\/s\/[0-9a-f]+\/(\d+)-\d+$/i.exec(url.pathname);
    if (!path) continue;
    if (gid !== null && path[1] !== gid) continue;
    const absolute = url.toString();
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    links.push(absolute);
  }
  return links;
}

/** Whether this document is the gallery it should be, rather than the "no access" or an error page. */
function looksLikeGallery(document: Document): boolean {
  return document.querySelector("#gn") !== null || document.querySelector("a[href*='/s/']") !== null;
}

/**
 * The image on one image page. Null when the page isn't one — which is how the daily image limit shows up, since the
 * site answers with a notice page rather than an error status.
 */
function imageOn(document: Document): { url: string | null; limited: boolean } {
  const src = document.querySelector("#img")?.getAttribute("src") ?? null;
  const text = document.body?.textContent ?? "";
  const limited = /bandwidth|image limit|509/i.test(text) && src === null;
  return { url: src, limited };
}

/**
 * The walk itself, with the pause between requests as a parameter: the real extractor waits a second, and the tests
 * pass zero so a fixture gallery doesn't take a minute to read.
 */
export function createExhentaiExtractor(intervalMs = MIN_INTERVAL_MS): Extractor {
  return {
    id: "exhentai",
    label: "ExHentai",
    matches,
    minIntervalMs: MIN_INTERVAL_MS,

    async extract(ctx: ExtractContext): Promise<ChapterExtract> {
      if (!looksLikeGallery(ctx.document)) {
        ctx.log("this doesn't look like a gallery — if you aren't signed in, the site shows a placeholder page instead");
        return { images: [], adult: true };
      }

      // Every gallery page, in order — including the ones before this one. The open page may be any of them: someone
      // who paged through to page 3 and then pressed Import would otherwise lose pages 1 and 2 and get 3 twice.
      const stated = Number.parseInt(ctx.url.searchParams.get("p") ?? "0", 10);
      const openPage = Number.isInteger(stated) && stated > 0 ? stated : 0;
      const claimed = lastPagerIndex(ctx.document);
      const lastPage = Math.min(Math.max(claimed, openPage), MAX_GALLERY_PAGES - 1);
      if (Math.max(claimed, openPage) > lastPage) {
        ctx.log(`the pager claims ${Math.max(claimed, openPage) + 1} pages; reading the first ${lastPage + 1}`);
      }

      // Collected by page index and flattened afterwards, so reading order doesn't depend on which page was open
      const byPage = new Map<number, string[]>([[openPage, imagePageLinks(ctx.document, ctx.url)]]);
      for (let page = 0; page <= lastPage; page++) {
        if (page === openPage) continue;
        const url = new URL(ctx.url.toString());
        url.searchParams.set("p", String(page));
        await delay(intervalMs);
        ctx.log(`reading gallery page ${page + 1} of ${lastPage + 1}`);
        try {
          byPage.set(page, imagePageLinks(await ctx.fetchDocument(url.toString()), ctx.url));
        } catch (err) {
          // A gallery page that won't load costs its share of the images; the rest are still worth having
          ctx.log(`gallery page ${page + 1} couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const pageLinks: string[] = [];
      for (let page = 0; page <= lastPage; page++) pageLinks.push(...(byPage.get(page) ?? []));

      if (pageLinks.length > MAX_IMAGE_PAGES) {
        ctx.log(`${pageLinks.length} pages found, which is more than this reads in one go — stopping at ${MAX_IMAGE_PAGES}`);
        pageLinks.length = MAX_IMAGE_PAGES;
      }

      // Then each image page, which is where the address actually lives
      const images: string[] = [];
      for (const [index, link] of pageLinks.entries()) {
        await delay(intervalMs);
        ctx.log(`reading page ${index + 1} of ${pageLinks.length}`);
        let page: Document;
        try {
          page = await ctx.fetchDocument(link);
        } catch (err) {
          ctx.log(`page ${index + 1} couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const { url, limited } = imageOn(page);
        if (limited) {
          // The daily allowance is spent. What has been collected still imports, and a later run picks up the rest.
          ctx.log(`image limit reached after ${images.length} page(s) — try again later and the rest will follow`);
          break;
        }
        if (!url) {
          ctx.log(`page ${index + 1} had no image`);
          continue;
        }
        // Against `link`: the address lives on the image page, and resolving it against the gallery would be wrong
        images.push(new URL(url, link).toString());
      }

      const title = ctx.document.querySelector("#gj")?.textContent?.trim() || ctx.document.querySelector("#gn")?.textContent?.trim();
      ctx.log(`${images.length} image(s) from ${pageLinks.length} page(s)`);
      return {
        images,
        ...(title ? { title } : {}),
        // Every gallery here is adult; a series filed from this import inherits it
        adult: true,
      };
    },
  };
}

export const exhentaiExtractor: Extractor = createExhentaiExtractor();
