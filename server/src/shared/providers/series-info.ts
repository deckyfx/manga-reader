/**
 * What a series page says about itself, read from the metadata almost every site publishes for link previews.
 *
 * This is deliberately not a scraper: no per-site selectors, no guessing at markup. `og:title`, `og:description` and
 * `og:image` are the three things a site states plainly about a page, which is enough to start a series from and
 * leaves the contributor to correct the rest. Browser-safe, like the extractors beside it, so the extension reads a
 * page with the same code the server would.
 */

/** The content of the first meta tag among `names`, by `property` or by `name`. */
function meta(document: Document, ...names: string[]): string | undefined {
  for (const name of names) {
    const selector = `meta[property="${name}"], meta[name="${name}"]`;
    const content = document.querySelector(selector)?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return undefined;
}

export interface SeriesInfo {
  title: string;
  synopsis?: string;
  /** Absolute address of the cover the page advertises. */
  cover?: string;
  /** True when the page says it is adult, so the series starts hidden. */
  adult?: boolean;
}

/** Whether a page describes itself as adult, by the two conventions sites actually use. */
function saysAdult(document: Document): boolean {
  const rating = meta(document, "rating", "RATING")?.toLowerCase() ?? "";
  if (rating.includes("adult") || rating.includes("mature") || rating === "rta-5042-1996-1400-1577-rta") return true;
  return meta(document, "og:restrictions:age")?.toLowerCase().includes("18") === true;
}

/**
 * Reads a series page. The title is the only thing required: a page with nothing to say for itself isn't worth
 * offering, and a series with no title can't be filed.
 */
export function seriesInfoFrom(document: Document, url: URL): SeriesInfo | null {
  const title = meta(document, "og:title", "twitter:title") || document.title.trim();
  if (!title) return null;

  const synopsis = meta(document, "og:description", "description", "twitter:description");
  const cover = meta(document, "og:image", "og:image:url", "twitter:image");
  let absolute: string | undefined;
  if (cover) {
    try {
      const resolved = new URL(cover, url);
      // Only what can actually be fetched; a data: or javascript: cover is not a cover
      if (resolved.protocol === "http:" || resolved.protocol === "https:") absolute = resolved.toString();
    } catch {
      // An address the page can't even parse; the series simply starts without a cover
    }
  }

  return {
    title: title.slice(0, 200),
    ...(synopsis ? { synopsis: synopsis.slice(0, 4000) } : {}),
    ...(absolute ? { cover: absolute } : {}),
    ...(saysAdult(document) ? { adult: true } : {}),
  };
}
