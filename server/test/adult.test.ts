/**
 * Adult series: who sees them, and how thoroughly they are hidden from everyone else.
 *
 * The rule being pinned down is that hiding is total. A reader who hasn't asked for adult series gets the same
 * answer as for a series that never existed — 404, not 403 — from the listing, the series, its covers, its reviews,
 * its chapters and the images of its pages. A 403 anywhere would confirm the thing exists, which is what hiding it
 * is for.
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { users } from "@/db/schema";
import { PageStore } from "@/stores/page-store";
import { SeriesStore } from "@/stores/library-store";
import { WorkspaceStore } from "@/stores/workspace-store";
import { call, png, signedIn } from "./harness";

/** An adult series with one chapter holding one page. */
async function adultSeries(cookie: string): Promise<{ seriesId: number; chapterId: number; pageId: string }> {
  const made = await call<{ series: { id: number } }>(
    "POST", "/manage/api/series", { title: `Adult ${crypto.randomUUID()}`, adult: true }, { cookie },
  );
  const seriesId = made.body.series.id;
  const chapter = await call<{ unsorted: { id: number }[] }>(
    "POST", "/manage/api/chapters", { series_id: seriesId, title: "One" }, { cookie },
  );
  const chapterId = chapter.body.unsorted[0]!.id;
  const form = new FormData();
  form.append("files", new File([await png()], "1.png", { type: "image/png" }));
  await call("POST", `/manage/api/chapters/${chapterId}/pages`, form, { cookie });
  const [page] = await PageStore.listByChapter(chapterId);
  return { seriesId, chapterId, pageId: page.id };
}

/** Turns the reader's own switch on, as the profile page does. */
async function wantsAdult(cookie: string): Promise<void> {
  expect((await call("PATCH", "/auth/api/me", { show_adult: true }, { cookie })).status).toBe(200);
}

describe("a reader who hasn't asked for adult series", () => {
  test("doesn't see one in the library", async () => {
    const owner = await signedIn("contributor");
    const { seriesId } = await adultSeries(owner.cookie);

    const asGuest = await call<{ id: number }[]>("GET", "/read/api/series");
    expect(asGuest.body.some((entry) => entry.id === seriesId)).toBe(false);

    const reader = await signedIn("reader");
    const asReader = await call<{ id: number }[]>("GET", "/read/api/series", undefined, { cookie: reader.cookie });
    expect(asReader.body.some((entry) => entry.id === seriesId)).toBe(false);
  });

  test("doesn't see its tags either", async () => {
    const owner = await signedIn("contributor");
    const secret = `only-on-adult-${crypto.randomUUID().slice(0, 8)}`;
    const shared = `shared-${crypto.randomUUID().slice(0, 8)}`;
    await call("POST", "/manage/api/series", { title: `Adult ${crypto.randomUUID()}`, adult: true, tags: [secret, shared] }, { cookie: owner.cookie });
    await call("POST", "/manage/api/series", { title: `Plain ${crypto.randomUUID()}`, tags: [shared] }, { cookie: owner.cookie });

    const tags = await call<{ tag: string; count: number }[]>("GET", "/read/api/series/tags");
    // A tag only a hidden series carries would say it exists, and a shared tag's count would be a headcount of what
    // this reader can't see
    expect(tags.body.some((entry) => entry.tag === secret)).toBe(false);
    expect(tags.body.find((entry) => entry.tag === shared)?.count).toBe(1);

    const reader = await signedIn("reader");
    await wantsAdult(reader.cookie);
    const withAdult = await call<{ tag: string; count: number }[]>("GET", "/read/api/series/tags", undefined, { cookie: reader.cookie });
    expect(withAdult.body.some((entry) => entry.tag === secret)).toBe(true);
    expect(withAdult.body.find((entry) => entry.tag === shared)?.count).toBe(2);
  });

  test("gets 404 everywhere it could be reached, not 403", async () => {
    const owner = await signedIn("contributor");
    const { seriesId, chapterId, pageId } = await adultSeries(owner.cookie);
    const reader = await signedIn("reader");

    for (const as of [{}, { cookie: reader.cookie }]) {
      expect((await call("GET", `/read/api/series/${seriesId}`, undefined, as)).status).toBe(404);
      expect((await call("GET", `/read/api/series/${seriesId}/cover`, undefined, as)).status).toBe(404);
      expect((await call("GET", `/read/api/series/${seriesId}/covers`, undefined, as)).status).toBe(404);
      expect((await call("GET", `/read/api/series/${seriesId}/reviews`, undefined, as)).status).toBe(404);
      expect((await call("GET", `/read/api/chapters/${chapterId}`, undefined, as)).status).toBe(404);
      expect((await call("GET", `/read/api/chapters/${chapterId}/reviews`, undefined, as)).status).toBe(404);
      // The page id is handed out freely elsewhere, so this is the one that would leak by being different
      expect((await call("GET", `/read/api/pages/${pageId}/image`, undefined, as)).status).toBe(404);
    }
  });
});

describe("a reader who has asked", () => {
  test("sees it everywhere", async () => {
    const owner = await signedIn("contributor");
    const { seriesId, chapterId, pageId } = await adultSeries(owner.cookie);
    const reader = await signedIn("reader");
    await wantsAdult(reader.cookie);

    const listed = await call<{ id: number }[]>("GET", "/read/api/series", undefined, { cookie: reader.cookie });
    expect(listed.body.some((entry) => entry.id === seriesId)).toBe(true);
    expect((await call("GET", `/read/api/series/${seriesId}`, undefined, { cookie: reader.cookie })).status).toBe(200);
    expect((await call("GET", `/read/api/chapters/${chapterId}`, undefined, { cookie: reader.cookie })).status).toBe(200);
    expect((await call("GET", `/read/api/pages/${pageId}/image`, undefined, { cookie: reader.cookie })).status).toBe(200);
  });

  test("the switch is off until they turn it on, and it is theirs alone", async () => {
    const reader = await signedIn("reader");
    const other = await signedIn("reader");
    const me = await call<{ user: { show_adult: boolean } }>("GET", "/auth/api/me", undefined, { cookie: reader.cookie });
    expect(me.body.user.show_adult).toBe(false);

    await wantsAdult(reader.cookie);
    const after = await call<{ user: { show_adult: boolean } }>("GET", "/auth/api/me", undefined, { cookie: reader.cookie });
    expect(after.body.user.show_adult).toBe(true);
    const theirs = await call<{ user: { show_adult: boolean } }>("GET", "/auth/api/me", undefined, { cookie: other.cookie });
    expect(theirs.body.user.show_adult).toBe(false);

    // A guest has nothing to turn on
    expect((await call("PATCH", "/auth/api/me", { show_adult: true })).status).toBe(401);
  });
});

describe("contributors and the library they curate", () => {
  test("see adult series in /manage whatever their own reader setting says", async () => {
    const owner = await signedIn("contributor");
    const { seriesId } = await adultSeries(owner.cookie);

    const inbox = await call<{ series: { adult: boolean } }>("GET", `/read/api/series/${seriesId}`, undefined, { cookie: owner.cookie });
    // The owner hasn't asked for adult series, so even they read it through /manage rather than /read
    expect(inbox.status).toBe(404);
    expect((await db.select().from(users).where(eq(users.id, owner.id)).get())?.showAdult).toBe(false);
    expect((await SeriesStore.findById(seriesId))?.adult).toBe(true);
  });
});

describe("an adult import", () => {
  test("makes the series it is filed into adult", async () => {
    const { cookie, id: userId } = await signedIn("contributor");
    const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Plain ${crypto.randomUUID()}` }, { cookie });
    const seriesId = series.body.series.id;
    const chapter = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: seriesId, title: "One" }, { cookie });
    const chapterId = chapter.body.unsorted[0]!.id;
    expect((await SeriesStore.findById(seriesId))?.adult).toBe(false);

    // A workspace an adult extractor made, with one page in it
    const workspace = await WorkspaceStore.create({
      name: "From an adult site", createdBy: userId, sourceUrl: "https://adult.test/g/1", sourceProvider: "exhentai", adult: true, chapterId: null,
    });
    const form = new FormData();
    form.append("files", new File([await png()], "1.png", { type: "image/png" }));
    form.append("start_index", "0");
    expect((await call("POST", `/studio/api/workspaces/${workspace.id}/pages`, form, { cookie })).status).toBe(200);

    expect((await call("POST", `/studio/api/workspaces/${workspace.id}/file`, { chapter_id: chapterId }, { cookie })).status).toBe(200);
    expect((await SeriesStore.findById(seriesId))?.adult).toBe(true);
  });

  test("marks the series before its pages arrive, not after", async () => {
    const { cookie, id: userId } = await signedIn("contributor");
    const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Timing ${crypto.randomUUID()}` }, { cookie });
    const seriesId = series.body.series.id;
    const chapter = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: seriesId, title: "One" }, { cookie });
    const chapterId = chapter.body.unsorted[0]!.id;

    const workspace = await WorkspaceStore.create({
      name: "Adult", createdBy: userId, sourceUrl: null, sourceProvider: "exhentai", adult: true, chapterId: null,
    });
    const form = new FormData();
    form.append("files", new File([await png()], "1.png", { type: "image/png" }));
    form.append("start_index", "0");
    await call("POST", `/studio/api/workspaces/${workspace.id}/pages`, form, { cookie });

    // Watched at the one moment that matters: as each page moves into the chapter. A reader asking then must not
    // find the series still reading as ordinary while its adult pages are already in it. Polling alongside would
    // prove nothing — the window is a few milliseconds and a poll can simply miss it — so the move itself reports
    const movePage = PageStore.filePage.bind(PageStore);
    const adultWhenPageMoved: (boolean | undefined)[] = [];
    PageStore.filePage = async (id, fields) => {
      if (fields.chapterId === chapterId) adultWhenPageMoved.push((await SeriesStore.findById(seriesId))?.adult);
      return movePage(id, fields);
    };

    try {
      expect((await call("POST", `/studio/api/workspaces/${workspace.id}/file`, { chapter_id: chapterId }, { cookie })).status).toBe(200);
    } finally {
      PageStore.filePage = movePage;
    }

    expect(adultWhenPageMoved).toHaveLength(1);
    expect(adultWhenPageMoved[0]).toBe(true);
    expect((await SeriesStore.findById(seriesId))?.adult).toBe(true);
  });
});
