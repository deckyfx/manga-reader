/**
 * Filing pages from a list of addresses, into a chapter and into a Studio workspace.
 *
 * `fetchImage` refuses private networks on purpose, so these go through the service with an injected download
 * pointing at a local server — the same seam the SSRF guard was built with. The routes themselves are covered for
 * what they validate and who may call them.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { importUrlsIntoChapter, importUrlsIntoWorkspace, nameFromUrl, tidyUrls } from "@/services/url-import";
import { WorkspaceStore } from "@/stores/workspace-store";
import { PageStore } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

/**
 * A local image host, and a downloader that reaches it. The real `fetchImage` refuses private networks on purpose,
 * so a test server can't be reached through it — which is the guard working, not a gap. The route-level test below
 * still goes through the real thing to prove it.
 */
let server: ReturnType<typeof Bun.serve>;
let origin: string;
const download = async (url: string): Promise<Buffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the host answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

beforeAll(async () => {
  const image = await png("#2255aa", 40, 60);
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/missing.png") return new Response("gone", { status: 404 });
      if (pathname === "/not-an-image.png") return new Response("hello", { headers: { "content-type": "text/plain" } });
      return new Response(image, { headers: { "content-type": "image/png" } });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

async function aChapter(cookie: string): Promise<number> {
  const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `URLs ${crypto.randomUUID()}` }, { cookie });
  const chapter = await call<{ unsorted: { id: number }[] }>(
    "POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "One" }, { cookie },
  );
  return chapter.body.unsorted[0]!.id;
}

describe("naming a page after its address", () => {
  test("uses the file name, then the last segment, then the host", () => {
    expect(nameFromUrl("https://host.test/manga/ch1/003.png")).toBe("003.png");
    expect(nameFromUrl("https://host.test/manga/ch1/")).toBe("ch1");
    expect(nameFromUrl("https://host.test/")).toBe("host.test");
    expect(nameFromUrl("not a url at all")).toBe("not a url at all");
  });
});

describe("tidying the list given", () => {
  test("trims, drops blanks, and keeps a repeated address once, in the order given", () => {
    expect(tidyUrls([" https://a.test/1.png ", "", "https://a.test/2.png", "https://a.test/1.png"]))
      .toEqual(["https://a.test/1.png", "https://a.test/2.png"]);
  });
});

describe("into a chapter", () => {
  test("downloads them in the order given", async () => {
    const { cookie } = await signedIn("contributor");
    const chapterId = await aChapter(cookie);

    const report = await importUrlsIntoChapter(chapterId, [`${origin}/1.png`, `${origin}/2.png`, `${origin}/3.png`], download);
    expect(report.skipped).toEqual([]);
    expect(report.pages.map((page) => page.name)).toEqual(["1", "2", "3"]);

    const pages = await PageStore.listByChapter(chapterId);
    expect(pages.map((page) => page.name)).toEqual(["1", "2", "3"]);
    // The address is kept as the page's source, so where it came from is still on record
    expect(pages[0].source).toBe(`${origin}/1.png`);
  });

  test("an address with no file extension is still an image", async () => {
    const { cookie } = await signedIn("contributor");
    const chapterId = await aChapter(cookie);

    // `/image` and `/download?id=5` are ordinary image endpoints; the import gates on the name, so they need one
    const report = await importUrlsIntoChapter(chapterId, [`${origin}/image`, `${origin}/download?id=5`], download);
    expect(report.skipped).toEqual([]);
    expect(report.pages.map((page) => page.name)).toEqual(["image", "download"]);
  });

  test("one address failing is a skipped entry, not a failed import", async () => {
    const { cookie } = await signedIn("contributor");
    const chapterId = await aChapter(cookie);

    const report = await importUrlsIntoChapter(
      chapterId,
      [`${origin}/1.png`, `${origin}/missing.png`, `${origin}/not-an-image.png`, `${origin}/4.png`],
      download,
    );
    expect(report.pages.map((page) => page.name)).toEqual(["1", "4"]);
    expect(report.skipped.map((entry) => entry.name).sort()).toEqual(["missing.png", "not-an-image.png"]);
    expect(report.skipped.every((entry) => entry.reason.length > 0)).toBe(true);
  });
});

describe("into a workspace", () => {
  test("pages land at the positions given, and a failure leaves its position free", async () => {
    const { cookie, id: userId } = await signedIn("contributor");
    const workspace = await WorkspaceStore.create({
      name: "From addresses", createdBy: userId, sourceUrl: null, sourceProvider: null, adult: false, chapterId: null,
    });

    const report = await importUrlsIntoWorkspace(
      workspace.id,
      0,
      [`${origin}/1.png`, `${origin}/missing.png`, `${origin}/3.png`],
      download,
    );
    expect(report.pages.map((page) => page.index)).toEqual([0, 2]);
    expect(report.skipped.map((entry) => entry.index)).toEqual([1]);

    // Retrying the whole list fills the gap and leaves the pages that are already there alone
    const retry = await importUrlsIntoWorkspace(
      workspace.id,
      0,
      [`${origin}/1.png`, `${origin}/2.png`, `${origin}/3.png`],
      download,
    );
    expect(retry.existing.sort()).toEqual([0, 2]);
    expect(retry.pages.map((page) => page.index)).toEqual([1]);

    const pages = await WorkspaceStore.pages(workspace.id);
    expect(pages.map((page) => page.sortOrder)).toEqual([1, 2, 3]);

    void cookie;
  });
});

describe("the routes", () => {
  test("a repeated address becomes one page, not two", async () => {
    const { cookie } = await signedIn("contributor");
    const chapterId = await aChapter(cookie);

    // Through the route, which is where the list is tidied. These addresses are refused as private, so each one
    // that reached a download left exactly one skipped entry: two entries would mean the repeat was downloaded too
    const viaRoute = await call<{ imported: number; skipped: { name: string }[] }>(
      "POST", `/manage/api/chapters/${chapterId}/pages/urls`, { urls: [`${origin}/9.png`, `${origin}/9.png`] }, { cookie },
    );
    expect(viaRoute.status).toBe(200);
    expect(viaRoute.body.skipped).toHaveLength(1);
    expect(viaRoute.body.skipped[0].name).toBe("9.png");
  });

  test("a chapter import needs at least one address, and a chapter that exists", async () => {
    const { cookie } = await signedIn("contributor");
    const chapterId = await aChapter(cookie);

    expect((await call("POST", `/manage/api/chapters/${chapterId}/pages/urls`, { urls: ["  "] }, { cookie })).status).toBe(422);
    expect((await call("POST", `/manage/api/chapters/999999/pages/urls`, { urls: ["https://host.test/1.png"] }, { cookie })).status).toBe(404);
  });

  test("a workspace import needs a workspace that exists, and a reader may not import at all", async () => {
    const reader = await signedIn("reader");
    const { id: userId } = await signedIn("contributor");
    const workspace = await WorkspaceStore.create({
      name: "Guarded", createdBy: userId, sourceUrl: null, sourceProvider: null, adult: false, chapterId: null,
    });

    expect((await call("POST", "/studio/api/workspaces/999999/pages/urls", { urls: ["https://host.test/1.png"], start_index: 0 }, { cookie: reader.cookie })).status).toBe(403);
    expect((await call("POST", `/studio/api/workspaces/${workspace.id}/pages/urls`, { urls: ["https://host.test/1.png"], start_index: 0 })).status).toBe(401);
  });

  test("addresses on a private network are refused, as they are everywhere else", async () => {
    const { cookie } = await signedIn("contributor");
    const chapterId = await aChapter(cookie);

    // Straight through the route, so the real download applies: this is the SSRF guard, not a download failure
    const res = await call<{ imported: number; skipped: { reason: string }[] }>(
      "POST", `/manage/api/chapters/${chapterId}/pages/urls`, { urls: [`http://127.0.0.1:1/secret.png`] }, { cookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped[0]?.reason).toMatch(/private or local|could not resolve/i);
  });
});
