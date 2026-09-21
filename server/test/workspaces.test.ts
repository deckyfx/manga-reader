/**
 * Studio workspaces: the CRUD routes, and appending uploads in batches the way the extension will (P3 of
 * docs/PLAN_providers_workspaces.md).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pageDir, PageStore } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

let cookie = "";

beforeAll(async () => {
  ({ cookie } = await signedIn("contributor"));
});

/** A multipart batch of images, as the extension uploads them. */
async function batch(startIndex: number, names: string[], sources?: unknown): Promise<FormData> {
  const form = new FormData();
  for (const [i, name] of names.entries()) {
    const bytes = name.endsWith(".txt") ? new TextEncoder().encode("not an image") : await png(`#${(i * 40 + 20).toString(16).padStart(2, "0")}6699`);
    form.append("files", new File([bytes], name));
  }
  form.append("start_index", String(startIndex));
  if (sources !== undefined) form.append("sources", JSON.stringify(sources));
  return form;
}

async function create(body: Record<string, unknown>): Promise<number> {
  const res = await call<{ id: number }>("POST", "/studio/api/workspaces", body, { cookie });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe("workspaces", () => {
  test("are created, listed, found by source URL and renamed", async () => {
    const url = `https://example.test/series/chapter-${crypto.randomUUID()}`;
    const id = await create({ name: "  Chapter 12  ", source_url: url, source_provider: "generic", adult: false });

    const list = await call<{ id: number; name: string; pages: number }[]>("GET", "/studio/api/workspaces", undefined, { cookie });
    expect(list.body.find((w) => w.id === id)).toMatchObject({ name: "Chapter 12", pages: 0 });

    const bySource = await call<{ id: number }[]>("GET", `/studio/api/workspaces?source_url=${encodeURIComponent(url)}`, undefined, { cookie });
    expect(bySource.body.map((w) => w.id)).toEqual([id]);

    const renamed = await call("PATCH", `/studio/api/workspaces/${id}`, { name: "Ch. 12", adult: true }, { cookie });
    expect(renamed.status).toBe(200);
    expect(renamed.body.workspace).toMatchObject({ name: "Ch. 12", adult: true });
  });

  test("keep an import's tags as suggestions, normalised like series tags", async () => {
    const created = await call<{ id: number; tags: string[] }>(
      "POST", "/studio/api/workspaces",
      { name: "Tagged", tags: ["Parody:Azur Lane", "character:some name", "parody:azur lane "] },
      { cookie },
    );
    // Lower case, trimmed, each once — the same rule series tags follow, so they drop straight into a new series
    expect(created.body.tags).toEqual(["character:some name", "parody:azur lane"]);
    const listed = await call<{ id: number; tags: string[] }[]>("GET", "/studio/api/workspaces", undefined, { cookie });
    expect(listed.body.find((w) => w.id === created.body.id)?.tags).toEqual(["character:some name", "parody:azur lane"]);
  });

  test("need a name, a contributor, and an existing id", async () => {
    expect((await call("POST", "/studio/api/workspaces", { name: "   " }, { cookie })).status).toBe(422);
    const reader = await signedIn("reader");
    expect((await call("POST", "/studio/api/workspaces", { name: "x" }, { cookie: reader.cookie })).status).toBe(403);
    expect((await call("GET", "/studio/api/workspaces/999999", undefined, { cookie })).status).toBe(404);
    expect((await call("POST", "/studio/api/workspaces/999999/pages", await batch(0, ["a.png"]), { cookie })).status).toBe(404);
  });

  test("append uploads in order, and a retried batch adds nothing twice", async () => {
    const id = await create({ name: "Import" });
    const first = await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["001.png", "002.png"], ["https://img.test/1.png", "https://img.test/2.png"]), { cookie });
    expect(first.status).toBe(200);
    expect(first.body.imported).toBe(2);
    expect(first.body.pages.map((p: { name: string; source: string }) => [p.name, p.source])).toEqual([["001", "https://img.test/1.png"], ["002", "https://img.test/2.png"]]);

    // The same batch again (a dropped connection): both positions are already filled
    const retry = await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["001.png", "002.png"]), { cookie });
    expect(retry.body).toMatchObject({ imported: 0, existing: [0, 1] });

    // Two copies of the next batch at once still store it once
    const [a, b] = await Promise.all([
      call("POST", `/studio/api/workspaces/${id}/pages`, await batch(2, ["003.png", "004.txt"]), { cookie }),
      call("POST", `/studio/api/workspaces/${id}/pages`, await batch(2, ["003.png", "004.txt"]), { cookie }),
    ]);
    expect(a.body.imported + b.body.imported).toBe(1);
    const detail = await call("GET", `/studio/api/workspaces/${id}`, undefined, { cookie });
    expect(detail.body.pages.map((p: { name: string }) => p.name)).toEqual(["001", "002", "003"]);
    expect(detail.body.workspace).toMatchObject({ pages: 3, idle: 3, done: 0 });
    expect(a.body.skipped.concat(b.body.skipped)).toContainEqual({ name: "004.txt", index: 3, reason: "not an image, or it could not be stored" });
  });

  test("append past a gap left by a deleted page", async () => {
    const id = await create({ name: "Gappy" });
    const first = await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["1.png", "2.png"]), { cookie });
    const gone: string = first.body.pages[0].id;
    expect((await call("DELETE", `/studio/api/pages/${gone}`, undefined, { cookie })).status).toBe(200);

    // Position 0 is free again, but the next batch belongs after page 2 — the client is told where that is
    const detail = await call("GET", `/studio/api/workspaces/${id}`, undefined, { cookie });
    expect(detail.body.workspace.next_index).toBe(2);
    const added = await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(detail.body.workspace.next_index, ["3.png"]), { cookie });
    expect(added.body).toMatchObject({ imported: 1, existing: [] });
    expect(added.body.pages.map((p: { name: string }) => p.name)).toEqual(["2", "3"]);
  });

  test("take a single file with its source, as a page-at-a-time import sends it", async () => {
    const id = await create({ name: "One at a time" });
    // One file and one source: form data sends that source as a plain string, not a one-item list
    const form = new FormData();
    form.append("files", new File([await png("#123456")], "001.png"));
    form.append("start_index", "0");
    form.append("sources", "https://exhentai.test/s/abc/1-1");

    const res = await call("POST", `/studio/api/workspaces/${id}/pages`, form, { cookie });
    expect(res.status).toBe(200);
    expect(res.body.pages[0]).toMatchObject({ source: "https://exhentai.test/s/abc/1-1" });
  });

  test("refuse a sources list that doesn't match the files", async () => {
    const id = await create({ name: "Mismatch" });
    const res = await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["a.png", "b.png"], ["only one"]), { cookie });
    expect(res.status).toBe(422);
  });

  test("keep their pages out of the loose list, and leave them loose when deleted", async () => {
    const id = await create({ name: "To delete" });
    const upload = await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["only.png"]), { cookie });
    const pageId: string = upload.body.pages[0].id;

    const loose = async () => (await call<{ id: string }[]>("GET", "/studio/api/pages", undefined, { cookie })).body.map((p) => p.id);
    expect(await loose()).not.toContain(pageId);

    expect((await call("DELETE", `/studio/api/workspaces/${id}`, undefined, { cookie })).status).toBe(200);
    const page = await call("GET", `/studio/api/pages/${pageId}`, undefined, { cookie });
    expect(page.status).toBe(200);
    expect(page.body.page.workspace_id).toBeNull();
    expect(await loose()).toContain(pageId);
  });
});

describe("running a workspace", () => {
  test("reports what a run would do, refuses an unknown workspace, and runs once at a time", async () => {
    expect((await call("GET", "/studio/api/workspaces/999999/run", undefined, { cookie })).status).toBe(404);
    expect((await call("POST", "/studio/api/workspaces/999999/run", {}, { cookie })).status).toBe(404);

    const id = await create({ name: "Run me" });
    expect((await call("GET", `/studio/api/workspaces/${id}/run`, undefined, { cookie })).body).toEqual({ workspace_id: id, pending: 0 });

    await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["001.png", "002.png"]), { cookie });
    // Freshly imported pages have an original and no stages, so both are waiting to be translated
    expect((await call("GET", `/studio/api/workspaces/${id}/run`, undefined, { cookie })).body).toEqual({ workspace_id: id, pending: 2 });

    // Two starts at once are serialised by the workspace lock: the second is refused while the first is going, or
    // starts its own run once that one is over. What must not happen is two runs at once.
    const [a, b] = await Promise.all([
      call("POST", `/studio/api/workspaces/${id}/run`, {}, { cookie }),
      call("POST", `/studio/api/workspaces/${id}/run`, {}, { cookie }),
    ]);
    expect([a.status, b.status].filter((code) => code === 202).length).toBeGreaterThan(0);
    expect([a.status, b.status].every((code) => code === 202 || code === 409)).toBe(true);
    const started = a.status === 202 ? a.body : b.body;
    expect(started).toMatchObject({ workspaceId: id, total: 2 });

    // The models aren't loaded in a test run, so each page is refused and counted; the run still finishes cleanly
    let state = started;
    for (let i = 0; i < 50 && state.running; i++) {
      await Bun.sleep(20);
      state = (await call("GET", `/studio/api/workspaces/${id}/run`, undefined, { cookie })).body;
    }
    expect(state).toMatchObject({ running: false, total: 2, done: 0, failed: 2 });
    expect(state.error).toContain("not ready");
  });
});

describe("filing a workspace into a chapter", () => {
  test("moves its pages in order and binds the workspace to the chapter", async () => {
    const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Filed ${crypto.randomUUID()}` }, { cookie });
    const seriesId = series.body.series.id;
    const detail = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: seriesId, title: "Chapter 1" }, { cookie });
    const chapterId = detail.body.unsorted[0]!.id;

    const id = await create({ name: "To file" });
    await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["a.png", "b.png"]), { cookie });

    const filed = await call("POST", `/studio/api/workspaces/${id}/file`, { chapter_id: chapterId }, { cookie });
    expect(filed.status).toBe(200);
    // Nothing is translated yet, so nothing is published: the pages move and wait to be run
    expect(filed.body).toMatchObject({ filed: 2, published: 0, skipped: [] });
    expect(filed.body.workspace.chapter_id).toBe(chapterId);

    // They are the chapter's pages now, in workspace order, and still listed with the workspace
    const inChapter = await call<{ id: string }[]>("GET", `/studio/api/pages?filed=chapter&chapter_id=${chapterId}`, undefined, { cookie });
    expect(inChapter.body.map((p) => p.id).sort()).toEqual(filed.body.pages.map((p: { id: string }) => p.id).sort());
    expect(filed.body.pages.every((p: { chapter_id: number | null }) => p.chapter_id === chapterId)).toBe(true);
  });

  test("publishes a page that is ready, and says why one isn't", async () => {
    const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Ready ${crypto.randomUUID()}` }, { cookie });
    const made = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "One" }, { cookie });
    const chapterId = made.body.unsorted[0]!.id;
    const id = await create({ name: "Half done" });
    const uploaded = await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["ready.png", "raw.png"]), { cookie });
    const readyId: string = uploaded.body.pages[0].id;

    // Stand in for a burn on the first page only; the second has never been run
    await Bun.write(join(pageDir(readyId), "result.png"), await png("#445566"));
    // …and a stale render on it would mean readers get an image that isn't current
    const stalePage: string = uploaded.body.pages[1].id;
    await Bun.write(join(pageDir(stalePage), "result.png"), await png("#665544"));
    await PageStore.setStage(stalePage, "render", "stale");

    const filed = await call("POST", `/studio/api/workspaces/${id}/file`, { chapter_id: chapterId }, { cookie });
    expect(filed.body).toMatchObject({ filed: 2, published: 1 });
    expect(filed.body.skipped[0].reason).toContain("moved, not published");

    const page = await call("GET", `/studio/api/pages/${readyId}`, undefined, { cookie });
    expect(page.body.page).toMatchObject({ revision: 1, published: true, chapter_id: chapterId });
  });

  test("won't file a workspace that already works on a chapter", async () => {
    const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Twice ${crypto.randomUUID()}` }, { cookie });
    const made = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "One" }, { cookie });
    const chapterId = made.body.unsorted[0]!.id;
    const id = await create({ name: "Filed once" });
    await call("POST", `/studio/api/workspaces/${id}/pages`, await batch(0, ["a.png"]), { cookie });

    expect((await call("POST", `/studio/api/workspaces/${id}/file`, { chapter_id: chapterId }, { cookie })).status).toBe(200);
    // Filing again would move its pages out from under the chapter it is bound to
    expect((await call("POST", `/studio/api/workspaces/${id}/file`, { chapter_id: chapterId }, { cookie })).status).toBe(409);
  });

  test("refuse an unknown workspace or chapter", async () => {
    const id = await create({ name: "Nowhere" });
    expect((await call("POST", `/studio/api/workspaces/${id}/file`, { chapter_id: 999999 }, { cookie })).status).toBe(404);
    expect((await call("POST", "/studio/api/workspaces/999999/file", { chapter_id: 1 }, { cookie })).status).toBe(404);
  });
});

describe("sending a chapter to the Studio", () => {
  /** A series with one chapter holding `count` imported pages. */
  async function chapterWithPages(count: number): Promise<{ chapterId: number; pageIds: string[] }> {
    const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Sent ${crypto.randomUUID()}` }, { cookie });
    const detail = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "Chapter 1" }, { cookie });
    const chapterId = detail.body.unsorted[0]!.id;
    const form = new FormData();
    for (let i = 0; i < count; i++) form.append("files", new File([await png(`#${(i + 3).toString(16).repeat(6)}`)], `p${i}.png`));
    await call("POST", `/manage/api/chapters/${chapterId}/pages`, form, { cookie });
    const inChapter = await call<{ id: string }[]>("GET", `/studio/api/pages?filed=chapter&chapter_id=${chapterId}`, undefined, { cookie });
    return { chapterId, pageIds: inChapter.body.map((p) => p.id) };
  }

  test("copies each page as a draft, and sending again only picks up what is missing", async () => {
    const { chapterId, pageIds } = await chapterWithPages(2);

    const sent = await call("POST", `/manage/api/chapters/${chapterId}/to-studio`, undefined, { cookie });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ copied: 2, existing: 0, skipped: [] });

    const detail = await call("GET", `/studio/api/workspaces/${sent.body.workspace_id}`, undefined, { cookie });
    expect(detail.body.workspace.chapter_id).toBe(chapterId);
    // The drafts are loose copies pointing back at the chapter's pages, which readers still get
    expect(detail.body.pages.map((p: { origin_page_id: string }) => p.origin_page_id).sort()).toEqual([...pageIds].sort());
    expect(detail.body.pages.every((p: { chapter_id: number | null }) => p.chapter_id === null)).toBe(true);

    const again = await call("POST", `/manage/api/chapters/${chapterId}/to-studio`, undefined, { cookie });
    expect(again.body).toMatchObject({ workspace_id: sent.body.workspace_id, copied: 0, existing: 2 });
  });

  test("publishing a draft publishes its chapter page instead", async () => {
    const { chapterId, pageIds } = await chapterWithPages(1);
    const originId = pageIds[0]!;
    const sent = await call("POST", `/manage/api/chapters/${chapterId}/to-studio`, undefined, { cookie });
    const detail = await call("GET", `/studio/api/workspaces/${sent.body.workspace_id}`, undefined, { cookie });
    const draftId: string = detail.body.pages[0].id;

    // Nothing has been rendered, so there is nothing readers could be given yet
    expect((await call("POST", `/studio/api/pages/${draftId}/publish`, undefined, { cookie })).status).toBe(409);

    // Stand in for a burn: the draft now holds a result the chapter page doesn't have
    await mkdir(pageDir(draftId), { recursive: true });
    await Bun.write(join(pageDir(draftId), "result.png"), await png("#112233"));

    const published = await call("POST", `/studio/api/pages/${draftId}/publish`, undefined, { cookie });
    expect(published.status).toBe(200);
    expect(published.body.revision).toBe(1);

    // The chapter page is the one published, and the draft stays in the workspace to edit again
    const origin = await call("GET", `/studio/api/pages/${originId}`, undefined, { cookie });
    expect(origin.body.page).toMatchObject({ revision: 1, published: true, has_result: true });
    const after = await call("GET", `/studio/api/workspaces/${sent.body.workspace_id}`, undefined, { cookie });
    expect(after.body.pages.map((p: { id: string }) => p.id)).toEqual([draftId]);
    // Measured against its origin, the draft has nothing unpublished left
    expect(after.body.pages[0]).toMatchObject({ published: true, has_edits: false });
  });

  test("publish all reports what it published", async () => {
    const { chapterId } = await chapterWithPages(1);
    const sent = await call("POST", `/manage/api/chapters/${chapterId}/to-studio`, undefined, { cookie });
    const id = sent.body.workspace_id;
    // No results anywhere: nothing to publish, and nothing refused either
    expect((await call("POST", `/studio/api/workspaces/${id}/publish`, undefined, { cookie })).body).toMatchObject({ published: 0, skipped: [] });
    expect((await call("POST", "/studio/api/workspaces/999999/publish", undefined, { cookie })).status).toBe(404);
  });
});
