/**
 * The extractor for sites nobody has written a rule for: it reads the page's images and keeps the group that looks
 * like a chapter.
 *
 * The guess is deliberately simple, because the popup's untick list is the safety net. A reader's pages are served
 * from one host and one folder, one after another in the markup, and they are large; the furniture around them (logo,
 * avatar, banner, the next-chapter thumbnail) is not. So: collect every address an `img` might be hiding, throw out
 * what is obviously not a page, group what is left by host and folder, and keep the biggest group in document order.
 */
import type { ChapterExtract, ExtractContext, Extractor } from "./types";

/** Attributes a lazy-loading reader may keep the real address in, in the order we trust them. */
const SRC_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original", "data-url", "src"] as const;

/** Addresses that are page furniture wherever they appear. */
const FURNITURE = /(?:^|[/_-])(?:logo|icon|avatar|banner|sprite|favicon|ads?|button|arrow|loading|spinner|placeholder)s?(?:[/_.-]|$)/i;

/** An image smaller than this in either direction, when the page says so, is furniture rather than a page. */
const MIN_PAGE_PIXELS = 300;

export interface Candidate {
  url: string;
  /** Host + folder, which is what a reader's pages share. */
  group: string;
}

/** Absolute form of `raw`, or null when it isn't a usable http(s) image address. */
function absolute(raw: string | null | undefined, base: URL): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // SVG is drawing, not a scanned page
    if (url.pathname.toLowerCase().endsWith(".svg")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The largest address in a `srcset`, which is the one worth downloading. */
function fromSrcset(value: string | null): string | null {
  if (!value) return null;
  let best: { url: string; weight: number } | null = null;
  for (const entry of value.split(",")) {
    const [url, descriptor] = entry.trim().split(/\s+/, 2);
    if (!url) continue;
    // "1024w" or "2x"; no descriptor means the single default
    const weight = descriptor ? Number.parseFloat(descriptor) || 0 : 1;
    if (!best || weight > best.weight) best = { url, weight };
  }
  return best?.url ?? null;
}

/** A dimension the page states, through an attribute or (in a real browser) what it actually loaded. */
function statedSize(image: Element, attribute: "width" | "height", natural: "naturalWidth" | "naturalHeight"): number | null {
  const stated = Number.parseInt(image.getAttribute(attribute) ?? "", 10);
  if (Number.isFinite(stated) && stated > 0) return stated;
  const loaded = (image as Partial<HTMLImageElement>)[natural];
  return typeof loaded === "number" && loaded > 0 ? loaded : null;
}

/** Whether the page itself says this image is too small to be a page of a chapter. */
function knownTooSmall(image: Element): boolean {
  const width = statedSize(image, "width", "naturalWidth");
  const height = statedSize(image, "height", "naturalHeight");
  // Unknown sizes are kept: plenty of readers state none, and dropping those would leave nothing
  return (width !== null && width < MIN_PAGE_PIXELS) || (height !== null && height < MIN_PAGE_PIXELS);
}

/** Host and folder — the key a reader's pages share and the furniture around them usually doesn't. */
function groupOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)}`;
}

/** Addresses inside `<noscript>`, which is where a lazy reader keeps its no-JavaScript fallback. */
function fromNoscript(document: Document, base: URL): string[] {
  const found: string[] = [];
  for (const block of Array.from(document.querySelectorAll("noscript"))) {
    // With scripts enabled the contents are text, not elements, so they are read as markup
    for (const match of (block.textContent ?? "").matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const url = absolute(match[1], base);
      if (url) found.push(url);
    }
  }
  return found;
}

/**
 * Every address the page's images might point at, in document order, with the obvious furniture dropped. Exported so
 * a site-specific extractor can reuse the collecting and keep only its own idea of where to look.
 */
export function collectCandidates(root: ParentNode, base: URL): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const add = (url: string | null) => {
    if (!url || seen.has(url) || FURNITURE.test(new URL(url).pathname)) return;
    seen.add(url);
    candidates.push({ url, group: groupOf(url) });
  };

  for (const image of Array.from(root.querySelectorAll("img"))) {
    if (knownTooSmall(image)) continue;
    const srcset = absolute(fromSrcset(image.getAttribute("srcset")), base);
    if (srcset) {
      add(srcset);
      continue;
    }
    for (const attribute of SRC_ATTRIBUTES) {
      const url = absolute(image.getAttribute(attribute), base);
      if (url) {
        add(url);
        break;
      }
    }
  }
  return candidates;
}

/** The biggest group of candidates (ties go to the one that starts first), in document order. */
export function largestGroup(candidates: Candidate[]): string[] {
  const groups = new Map<string, string[]>();
  for (const candidate of candidates) {
    groups.set(candidate.group, [...(groups.get(candidate.group) ?? []), candidate.url]);
  }
  let best: string[] = [];
  for (const urls of groups.values()) {
    if (urls.length > best.length) best = urls;
  }
  return best;
}

/** The series or gallery title the page advertises. */
export function titleOf(document: Document): string | undefined {
  const meta = document.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute("content")?.trim();
  return meta || document.title.trim() || undefined;
}

/** The chapter number in an address like `/chapter-14.2/` or `/ch/14`. */
export function chapterOf(url: URL): string | undefined {
  const match = /(?:chapter|chap|ch)[-_/ ]?(\d+(?:\.\d+)?)/i.exec(url.pathname);
  return match?.[1];
}

export const genericExtractor: Extractor = {
  id: "generic",
  label: "This page",
  // Tried last, so it never takes a page a site's own extractor handles better
  matches: () => true,
  minIntervalMs: 250,

  extract(ctx: ExtractContext): Promise<ChapterExtract> {
    const candidates = collectCandidates(ctx.document, ctx.url);
    const images = largestGroup(candidates);
    // The noscript fallback only matters when the images themselves gave nothing: a reader that lazy-loads every page
    // keeps its real addresses there, behind placeholders we have just dropped
    const found = images.length > 0 ? images : fromNoscript(ctx.document, ctx.url);
    ctx.log(`${found.length} image(s) from ${candidates.length} candidate(s)`);

    const title = titleOf(ctx.document);
    const chapter = chapterOf(ctx.url);
    return Promise.resolve({
      images: found,
      ...(title !== undefined ? { title } : {}),
      ...(chapter !== undefined ? { chapter } : {}),
    });
  },
};
