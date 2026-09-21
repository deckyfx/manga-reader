/**
 * Reading a series page's own description of itself, for "New series from this page".
 *
 * The same shape as the extractor tests: a DOM from linkedom, so the code the extension runs on a live page is the
 * code under test here.
 */
import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { seriesInfoFrom } from "@/shared/providers/series-info";

/** A page with the given `<head>` contents, read as a series page would be. */
function read(head: string, href = "https://host.test/series/one", body = "") {
  const { document } = parseHTML(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
  return seriesInfoFrom(document as unknown as Document, new URL(href));
}

describe("what a page says about itself", () => {
  test("title, synopsis and cover come from the metadata a site publishes for link previews", () => {
    const info = read(`
      <meta property="og:title" content="Kagurabachi">
      <meta property="og:description" content="A swordsmith's son.">
      <meta property="og:image" content="https://cdn.test/cover.jpg">
    `);
    expect(info).toEqual({ title: "Kagurabachi", synopsis: "A swordsmith's son.", cover: "https://cdn.test/cover.jpg" });
  });

  test("a gallery's own tags come along as suggestions", () => {
    const info = read("<title>A Gallery</title>", "https://exhentai.org/g/1/abc/", `<div id="taglist"><table>
           <tr><td class="tc">parody:</td><td><div id="td_parody:azur_lane"><a id="ta_parody:azur_lane">azur lane</a></div></td></tr>
           <tr><td class="tc">character:</td><td><div id="td_character:some_name"><a>some name</a></div>
             <div id="td_character:some_name"><a>some name</a></div></td></tr>
         </table></div>`);
    expect(info?.tags).toEqual(["parody:azur lane", "character:some name"]);
  });

  test("a page with no tag list offers none, rather than an empty list", () => {
    expect(read("<title>Plain series page</title>")).not.toHaveProperty("tags");
  });

  test("a relative cover is resolved against the page", () => {
    const info = read('<meta property="og:image" content="/img/cover.png"><title>Some series</title>');
    expect(info?.cover).toBe("https://host.test/img/cover.png");
  });

  test("the document title stands in when there is no og:title", () => {
    expect(read("<title>Plain old title</title>")?.title).toBe("Plain old title");
  });

  test("a page with no title at all is not worth offering", () => {
    expect(read("")).toBeNull();
  });

  test("twitter's tags are read when open graph's are missing", () => {
    const info = read(`
      <meta name="twitter:title" content="From twitter">
      <meta name="twitter:description" content="Described once">
      <meta name="twitter:image" content="https://cdn.test/t.jpg">
    `);
    expect(info).toMatchObject({ title: "From twitter", synopsis: "Described once", cover: "https://cdn.test/t.jpg" });
  });

  test("a cover that can't be fetched is left out rather than passed on", () => {
    // A data: cover is a real thing on some sites, and not something the server can be asked to download
    const info = read('<title>Series</title><meta property="og:image" content="data:image/png;base64,iVBOR">');
    expect(info?.cover).toBeUndefined();
    expect(info?.title).toBe("Series");
  });

  test("a page that calls itself adult starts the series hidden", () => {
    expect(read('<title>Gallery</title><meta name="rating" content="adult">')?.adult).toBe(true);
    expect(read('<title>Gallery</title><meta name="RATING" content="RTA-5042-1996-1400-1577-RTA">')?.adult).toBe(true);
    expect(read('<title>Gallery</title><meta property="og:restrictions:age" content="18+">')?.adult).toBe(true);
    // Nothing said means nothing assumed: an ordinary page is not adult
    expect(read("<title>Ordinary</title>")?.adult).toBeUndefined();
  });

  test("long text is cut to what the series routes accept", () => {
    const info = read(`
      <meta property="og:title" content="${"t".repeat(400)}">
      <meta property="og:description" content="${"d".repeat(5000)}">
    `);
    expect(info?.title).toHaveLength(200);
    expect(info?.synopsis).toHaveLength(4000);
  });
});
