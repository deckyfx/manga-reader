/**
 * Cover art: a series may hold several, and which one it shows is decided in one place.
 *
 * The rule: the pinned cover, else the newest, else the first page of the first chapter. Everything here is about
 * that rule surviving uploads, pins, deletions and a pin left pointing at nothing.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { series as seriesTable } from "@/db/schema";
import { coverFile } from "@/plugins/read/index";
import { coverFilePath } from "@/services/library-covers";
import { CoverStore } from "@/stores/cover-store";
import { SeriesStore } from "@/stores/library-store";
import { call, png, signedIn } from "./harness";

interface Cover { id: number; label: string | null; current: boolean; pinned: boolean }

async function newSeries(cookie: string): Promise<number> {
  const made = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Covers ${crypto.randomUUID()}` }, { cookie });
  return made.body.series.id;
}

/** Uploads one cover and answers with the gallery as the server returns it. */
async function addCover(cookie: string, seriesId: number, label?: string, colour = "#884466"): Promise<Cover[]> {
  const form = new FormData();
  form.append("cover", new File([await png(colour, 60, 90)], "cover.png", { type: "image/png" }));
  if (label) form.append("label", label);
  const res = await call<Cover[]>("POST", `/manage/api/series/${seriesId}/covers`, form, { cookie });
  expect(res.status).toBe(200);
  return res.body;
}

describe("which cover a series shows", () => {
  test("the newest, until one is pinned", async () => {
    const { cookie } = await signedIn("contributor");
    const id = await newSeries(cookie);

    const first = (await addCover(cookie, id, "first"))[0];
    expect(first.current).toBe(true);

    const afterSecond = await addCover(cookie, id, "second");
    // Newest first, and the newest is the one on display
    expect(afterSecond.map((cover) => cover.label)).toEqual(["second", "first"]);
    expect(afterSecond[0].current).toBe(true);
    expect(afterSecond[0].pinned).toBe(false);

    const pinned = await call<Cover[]>("PUT", `/manage/api/series/${id}/covers/${first.id}/pin`, undefined, { cookie });
    expect(pinned.body.find((cover) => cover.id === first.id)).toMatchObject({ current: true, pinned: true });
    expect(pinned.body.find((cover) => cover.label === "second")?.current).toBe(false);

    const unpinned = await call<Cover[]>("DELETE", `/manage/api/series/${id}/covers/pin`, undefined, { cookie });
    expect(unpinned.body.find((cover) => cover.label === "second")?.current).toBe(true);
  });

  test("deleting the pinned cover falls back to the newest left, and takes the file with it", async () => {
    const { cookie } = await signedIn("contributor");
    const id = await newSeries(cookie);
    const older = (await addCover(cookie, id, "older"))[0];
    await addCover(cookie, id, "newer");
    await call("PUT", `/manage/api/series/${id}/covers/${older.id}/pin`, undefined, { cookie });

    const file = coverFilePath((await CoverStore.find(id, older.id))!.path);
    expect(existsSync(file)).toBe(true);

    const left = await call<Cover[]>("DELETE", `/manage/api/series/${id}/covers/${older.id}`, undefined, { cookie });
    expect(left.body.map((cover) => cover.label)).toEqual(["newer"]);
    expect(left.body[0].current).toBe(true);
    expect(existsSync(file)).toBe(false);
    // The pin went with it, rather than being left pointing at a cover that no longer exists
    expect((await SeriesStore.findById(id))?.coverId).toBeNull();
  });

  test("a pin left pointing at nothing still shows the newest", async () => {
    const { cookie } = await signedIn("contributor");
    const id = await newSeries(cookie);
    const only = (await addCover(cookie, id, "only"))[0];
    // Straight to the database: a row edited by hand, or left by an older build
    await db.update(seriesTable).set({ coverId: only.id + 9999 }).where(eq(seriesTable.id, id));

    const covers = await call<Cover[]>("GET", `/read/api/series/${id}/covers`, undefined, { cookie });
    expect(covers.body[0]).toMatchObject({ id: only.id, current: true, pinned: false });

    const entry = await SeriesStore.withCounts(id);
    expect(coverFile(entry!)).not.toBeNull();
  });

  test("a series with no cover art falls back to its first page, and says it has a cover", async () => {
    const { cookie } = await signedIn("contributor");
    const id = await newSeries(cookie);
    const chapter = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: id, title: "One" }, { cookie });
    const form = new FormData();
    form.append("files", new File([await png()], "1.png", { type: "image/png" }));
    await call("POST", `/manage/api/chapters/${chapter.body.unsorted[0]!.id}/pages`, form, { cookie });

    const entry = await SeriesStore.withCounts(id);
    expect(entry?.coverArt).toBeNull();
    expect(coverFile(entry!)).not.toBeNull();
    expect((await call<{ series: { has_cover: boolean } }>("GET", `/read/api/series/${id}`)).body.series.has_cover).toBe(true);
  });
});

describe("the cover routes", () => {
  test("one cover's image can be fetched on its own", async () => {
    const { cookie } = await signedIn("contributor");
    const id = await newSeries(cookie);
    const cover = (await addCover(cookie, id))[0];

    const res = await call("GET", `/read/api/series/${id}/covers/${cover.id}`);
    expect(res.status).toBe(200);
    expect((await call("GET", `/read/api/series/${id}/covers/${cover.id + 4242}`)).status).toBe(404);
  });

  test("covers belong to their own series", async () => {
    const { cookie } = await signedIn("contributor");
    const mine = await newSeries(cookie);
    const other = await newSeries(cookie);
    const cover = (await addCover(cookie, mine))[0];

    // Pinning or deleting through the wrong series must not reach it
    expect((await call("PUT", `/manage/api/series/${other}/covers/${cover.id}/pin`, undefined, { cookie })).status).toBe(404);
    expect((await call("DELETE", `/manage/api/series/${other}/covers/${cover.id}`, undefined, { cookie })).status).toBe(404);
    expect((await call("GET", `/read/api/series/${other}/covers/${cover.id}`)).status).toBe(404);
    expect(await CoverStore.find(mine, cover.id)).toBeDefined();
  });

  test("deleting a series deletes its cover files", async () => {
    const { cookie } = await signedIn("contributor");
    const id = await newSeries(cookie);
    await addCover(cookie, id, "one");
    await addCover(cookie, id, "two");
    const files = (await CoverStore.paths(id)).map(coverFilePath);
    expect(files).toHaveLength(2);

    expect((await call("DELETE", `/manage/api/series/${id}`, undefined, { cookie })).status).toBe(200);
    for (const file of files) expect(existsSync(file)).toBe(false);
    expect(await CoverStore.list(id)).toEqual([]);
  });

  test("a reader may look but not touch", async () => {
    const { cookie } = await signedIn("contributor");
    const reader = await signedIn("reader");
    const id = await newSeries(cookie);
    const cover = (await addCover(cookie, id))[0];

    expect((await call("GET", `/read/api/series/${id}/covers`)).status).toBe(200);
    expect((await call("PUT", `/manage/api/series/${id}/covers/${cover.id}/pin`, undefined, { cookie: reader.cookie })).status).toBe(403);
    expect((await call("DELETE", `/manage/api/series/${id}/covers/${cover.id}`, undefined, { cookie: reader.cookie })).status).toBe(403);
  });
});
