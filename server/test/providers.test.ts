/**
 * The chapter extractors, against fixture HTML. A DOM comes from linkedom rather than a browser, which is all an
 * extractor is allowed to need — that is what lets the extension run the same code on a live page.
 *
 * Fixtures are written here rather than saved from the sites: they carry the shapes that matter (lazy attributes,
 * furniture, a reader with a sidebar), and a real saved page can be dropped in later without changing the tests.
 */
import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { genericExtractor } from "@/shared/providers/generic";
import { createExhentaiExtractor } from "@/shared/providers/exhentai";
import { rawkumaExtractor } from "@/shared/providers/rawkuma";
import { extractorById, extractorFor } from "@/shared/providers/registry";
import type { ChapterExtract, ExtractContext } from "@/shared/providers/types";

/** An extract context over fixture HTML; `fetchDocument` throws, since no fixture needs a second page yet. */
function contextFor(html: string, href: string): ExtractContext & { logs: string[] } {
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`);
  const logs: string[] = [];
  return {
    url: new URL(href),
    document: document as unknown as Document,
    fetchDocument: () => Promise.reject(new Error("no fixture asked for a second page")),
    log: (message: string) => logs.push(message),
    logs,
  };
}

const PAGES = (count: number, folder = "https://cdn.test/ch14") =>
  Array.from({ length: count }, (_, i) => `<img src="${folder}/${String(i + 1).padStart(3, "0")}.jpg">`).join("");

describe("choosing an extractor", () => {
  test("a rawkuma chapter goes to its own extractor, anything else to the generic one", () => {
    expect(extractorFor(new URL("https://rawkuma.net/manga/some-slug/chapter-14.12345/")).id).toBe("rawkuma");
    expect(extractorFor(new URL("https://www.rawkuma.net/manga/x/chapter-2.9/")).id).toBe("rawkuma");
    // The series page isn't a chapter, so the generic guess is the right one
    expect(extractorFor(new URL("https://rawkuma.net/manga/some-slug/")).id).toBe("generic");
    expect(extractorFor(new URL("https://example.test/reader/42")).id).toBe("generic");
    expect(extractorById("rawkuma")?.label).toBe("Rawkuma");
    expect(extractorById("nobody")).toBeUndefined();
  });
});

describe("the generic extractor", () => {
  test("keeps the biggest group of images and leaves the furniture out", async () => {
    const ctx = contextFor(
      `<img src="/assets/logo.png" width="120" height="40">
       <img src="https://avatars.test/u/7/avatar.jpg">
       <img src="https://ads.test/banner-728.png" width="728" height="90">
       ${PAGES(3)}
       <img src="https://cdn.test/thumbs/next-chapter.jpg" width="100" height="140">`,
      "https://reader.test/manga/x/chapter-14/",
    );
    const result: ChapterExtract = await genericExtractor.extract(ctx);
    expect(result.images).toEqual([
      "https://cdn.test/ch14/001.jpg",
      "https://cdn.test/ch14/002.jpg",
      "https://cdn.test/ch14/003.jpg",
    ]);
  });

  test("reads lazy attributes and srcset, resolves relative addresses, and keeps each page once", async () => {
    const ctx = contextFor(
      `<img data-src="/pages/1.jpg">
       <img data-lazy-src="/pages/2.jpg">
       <img data-original="/pages/3.jpg">
       <img src="/pages/placeholder.gif" data-src="/pages/4.jpg">
       <img srcset="/pages/5-small.jpg 480w, /pages/5.jpg 1600w">
       <img src="/pages/1.jpg">`,
      "https://reader.test/manga/x/chapter-7/",
    );
    const result = await genericExtractor.extract(ctx);
    expect(result.images).toEqual([
      "https://reader.test/pages/1.jpg",
      "https://reader.test/pages/2.jpg",
      "https://reader.test/pages/3.jpg",
      // The lazy attribute wins over the placeholder still in src
      "https://reader.test/pages/4.jpg",
      // The largest srcset entry is the one worth downloading
      "https://reader.test/pages/5.jpg",
    ]);
  });

  test("prefers a lazy srcset over the placeholder in src", async () => {
    const ctx = contextFor(
      `<img src="/pages/blank.gif" data-srcset="/pages/1-small.jpg 480w, /pages/1.jpg 1600w">
       <img src="/pages/blank.gif" data-lazy-srcset="/pages/2.jpg 1600w">`,
      "https://reader.test/manga/x/chapter-9/",
    );
    const result = await genericExtractor.extract(ctx);
    expect(result.images).toEqual(["https://reader.test/pages/1.jpg", "https://reader.test/pages/2.jpg"]);
  });

  test("falls back to the noscript markup when every image was a placeholder", async () => {
    const ctx = contextFor(
      `<img src="data:image/gif;base64,R0lGOD" width="10" height="10">
       <noscript><img src="https://cdn.test/ch3/001.jpg"><img src="https://cdn.test/ch3/002.jpg"></noscript>`,
      "https://reader.test/manga/x/chapter-3/",
    );
    const result = await genericExtractor.extract(ctx);
    expect(result.images).toEqual(["https://cdn.test/ch3/001.jpg", "https://cdn.test/ch3/002.jpg"]);
  });

  test("doesn't repeat an address the noscript markup lists twice", async () => {
    const ctx = contextFor(
      `<img src="data:image/gif;base64,R0lGOD" width="10" height="10">
       <noscript><img src="https://cdn.test/ch4/001.jpg"><img src="https://cdn.test/ch4/001.jpg"></noscript>`,
      "https://reader.test/manga/x/chapter-4/",
    );
    const result = await genericExtractor.extract(ctx);
    // Twice in the markup would otherwise become two pages of the chapter
    expect(result.images).toEqual(["https://cdn.test/ch4/001.jpg"]);
  });

  test("takes the title from og:title and the chapter from the address", async () => {
    const ctx = contextFor(`${PAGES(2)}`, "https://reader.test/manga/x/chapter-14.5/");
    ctx.document.head.innerHTML = '<meta property="og:title" content="Some Series — Chapter 14.5">';
    const result = await genericExtractor.extract(ctx);
    expect(result).toMatchObject({ title: "Some Series — Chapter 14.5", chapter: "14.5" });
  });

  test("says so when a page holds nothing that looks like a chapter", async () => {
    const ctx = contextFor(`<p>Nothing here</p>`, "https://reader.test/empty");
    const result = await genericExtractor.extract(ctx);
    expect(result.images).toEqual([]);
    expect(ctx.logs.join(" ")).toContain("0 image(s)");
  });
});

describe("the rawkuma extractor", () => {
  test("takes only what is inside the reader", async () => {
    const ctx = contextFor(
      `<div class="sidebar">${PAGES(4, "https://cdn.test/thumbs")}</div>
       <div id="readerarea">${PAGES(3)}</div>`,
      "https://rawkuma.net/manga/some-slug/chapter-14.12345/",
    );
    const result = await rawkumaExtractor.extract(ctx);
    // The sidebar has more images, so a whole-page guess would have picked the wrong ones
    expect(result.images).toEqual([
      "https://cdn.test/ch14/001.jpg",
      "https://cdn.test/ch14/002.jpg",
      "https://cdn.test/ch14/003.jpg",
    ]);
    expect(result.chapter).toBe("14");
  });

  test("breaks loudly when the reader isn't where it used to be", async () => {
    const ctx = contextFor(`<div class="brand-new-layout">${PAGES(3)}</div>`, "https://rawkuma.net/manga/x/chapter-1.9/");
    const result = await rawkumaExtractor.extract(ctx);
    // Better an empty import the popup can report than someone else's images
    expect(result.images).toEqual([]);
    expect(ctx.logs.join(" ")).toContain("layout may have changed");
  });
});

describe("the exhentai extractor", () => {
  /** No pause between requests, so a fixture gallery reads instantly instead of a second a page. */
  const extractor = createExhentaiExtractor(0);

  /** A context whose `fetchDocument` answers from a map of fixture pages. */
  function galleryContext(first: string, pages: Record<string, string>, href: string) {
    const ctx = contextFor(first, href);
    return {
      ...ctx,
      fetchDocument: (url: string) => {
        const html = pages[url];
        if (html === undefined) return Promise.reject(new Error(`no fixture for ${url}`));
        const { document } = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`);
        return Promise.resolve(document as unknown as Document);
      },
    };
  }

  const imagePage = (src: string) => `<div id="i3"><img id="img" src="${src}"></div>`;
  const GALLERY = "https://exhentai.org/g/123456/abcdef0123/";

  test("claims a gallery address, and leaves the rest alone", () => {
    expect(extractorFor(new URL(GALLERY)).id).toBe("exhentai");
    expect(extractorFor(new URL("https://e-hentai.org/g/99/deadbeef11/")).id).toBe("exhentai");
    // A search or listing page isn't a gallery
    expect(extractorFor(new URL("https://exhentai.org/?f_search=whatever")).id).toBe("generic");
  });

  test("walks the pager and every image page, in order", async () => {
    const ctx = galleryContext(
      `<h1 id="gn">A Gallery</h1><h1 id="gj">日本語の題</h1>
       <a href="/s/aaa111/123456-1">1</a><a href="/s/aaa222/123456-2">2</a>
       <table class="ptb"><tr><td><a href="?p=1">2</a></td></tr></table>`,
      {
        [`${GALLERY}?p=1`]: `<a href="/s/aaa333/123456-3">3</a>`,
        "https://exhentai.org/s/aaa111/123456-1": imagePage("https://hath.test/a/1.jpg"),
        "https://exhentai.org/s/aaa222/123456-2": imagePage("https://hath.test/b/2.jpg"),
        "https://exhentai.org/s/aaa333/123456-3": imagePage("https://hath.test/c/3.jpg"),
      },
      GALLERY,
    );

    const result = await extractor.extract(ctx);
    expect(result.images).toEqual([
      "https://hath.test/a/1.jpg",
      "https://hath.test/b/2.jpg",
      "https://hath.test/c/3.jpg",
    ]);
    // The Japanese title wins when there is one, and everything here is adult
    expect(result).toMatchObject({ title: "日本語の題", adult: true });
  });

  test("reads the pages before the open one, and each exactly once", async () => {
    const ctx = galleryContext(
      // The reader is on page 2 of 2 and presses Import there
      `<h1 id="gn">A Gallery</h1>
       <a href="/s/ccc333/123456-3">3</a><a href="/s/ddd444/123456-4">4</a>
       <table class="ptb"><tr><td><a href="?p=0">1</a></td><td><a href="?p=1">2</a></td></tr></table>`,
      {
        [`${GALLERY}?p=0`]: `<a href="/s/aaa111/123456-1">1</a><a href="/s/bbb222/123456-2">2</a>`,
        "https://exhentai.org/s/aaa111/123456-1": imagePage("https://hath.test/a/1.jpg"),
        "https://exhentai.org/s/bbb222/123456-2": imagePage("https://hath.test/b/2.jpg"),
        "https://exhentai.org/s/ccc333/123456-3": imagePage("https://hath.test/c/3.jpg"),
        "https://exhentai.org/s/ddd444/123456-4": imagePage("https://hath.test/d/4.jpg"),
      },
      `${GALLERY}?p=1`,
    );

    const result = await extractor.extract(ctx);
    // Gallery order, not "whatever page happened to be open first"
    expect(result.images).toEqual([
      "https://hath.test/a/1.jpg",
      "https://hath.test/b/2.jpg",
      "https://hath.test/c/3.jpg",
      "https://hath.test/d/4.jpg",
    ]);
  });

  test("resolves a relative image address against the page it was read from", async () => {
    const ctx = galleryContext(
      `<h1 id="gn">A Gallery</h1><a href="/s/aaa111/123456-1">1</a>`,
      { "https://exhentai.org/s/aaa111/123456-1": imagePage("keystamp/1.jpg") },
      GALLERY,
    );

    const result = await extractor.extract(ctx);
    // Against the image page it was read from. Resolved against the gallery instead, this would have been
    // /g/123456/abcdef0123/keystamp/1.jpg, which is nobody's image.
    expect(result.images).toEqual(["https://exhentai.org/s/aaa111/keystamp/1.jpg"]);
  });

  test("ignores links to another site or another gallery", async () => {
    const ctx = galleryContext(
      `<h1 id="gn">A Gallery</h1>
       <a href="/s/aaa111/123456-1">mine</a>
       <a href="https://mirror.test/s/bbb222/123456-2">another site</a>
       <a href="/s/ccc333/999999-1">another gallery</a>`,
      { "https://exhentai.org/s/aaa111/123456-1": imagePage("https://hath.test/a/1.jpg") },
      GALLERY,
    );

    const result = await extractor.extract(ctx);
    // Only this gallery's own page; the fixtures deliberately have no answer for the other two
    expect(result.images).toEqual(["https://hath.test/a/1.jpg"]);
  });

  test("won't walk a pager that claims thousands of pages", async () => {
    let fetched = 0;
    const ctx = contextFor(
      `<h1 id="gn">A Gallery</h1><a href="/s/aaa111/123456-1">1</a>
       <table class="ptb"><tr><td><a href="?p=99999">last</a></td></tr></table>`,
      GALLERY,
    );
    const counting = {
      ...ctx,
      fetchDocument: (url: string) => {
        fetched++;
        const body = url.includes("/s/") ? imagePage("https://hath.test/a/1.jpg") : "";
        const { document } = parseHTML(`<!doctype html><html><body>${body}</body></html>`);
        return Promise.resolve(document as unknown as Document);
      },
    };

    await extractor.extract(counting);
    // A page is free to claim any number of pages; the walk is bounded regardless
    expect(fetched).toBeLessThan(100);
    expect(ctx.logs.join(" ")).toContain("claims 100000 pages");
  });

  test("says when the gallery isn't visible rather than reporting an empty one", async () => {
    const ctx = galleryContext(`<img src="https://exhentai.org/img/sadpanda.jpg">`, {}, GALLERY);
    const result = await extractor.extract(ctx);
    expect(result).toMatchObject({ images: [], adult: true });
    expect(ctx.logs.join(" ")).toContain("aren't signed in");
  });

  test("stops at the image limit and keeps what it already collected", async () => {
    const ctx = galleryContext(
      `<h1 id="gn">A Gallery</h1><a href="/s/aaa111/123456-1">1</a><a href="/s/aaa222/123456-2">2</a>`,
      {
        "https://exhentai.org/s/aaa111/123456-1": imagePage("https://hath.test/a/1.jpg"),
        // The allowance is spent: a notice page rather than an error status
        "https://exhentai.org/s/aaa222/123456-2": `<div>You have temporarily exceeded your image viewing limit (509)</div>`,
      },
      GALLERY,
    );

    const result = await extractor.extract(ctx);
    expect(result.images).toEqual(["https://hath.test/a/1.jpg"]);
    expect(ctx.logs.join(" ")).toContain("image limit reached");
  });
});
