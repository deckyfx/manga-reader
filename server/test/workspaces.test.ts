/**
 * Studio workspaces: the CRUD routes, and appending uploads in batches the way the extension will (P3 of
 * docs/PLAN_providers_workspaces.md).
 */
import { beforeAll, describe, expect, test } from "bun:test";
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

    // Two starts at once: one takes the run, the other is told it is already going
    const [a, b] = await Promise.all([
      call("POST", `/studio/api/workspaces/${id}/run`, {}, { cookie }),
      call("POST", `/studio/api/workspaces/${id}/run`, {}, { cookie }),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const started = a.status === 202 ? a.body : b.body;
    expect(started).toMatchObject({ workspaceId: id, running: true, total: 2 });

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

  test("refuse an unknown workspace or chapter", async () => {
    const id = await create({ name: "Nowhere" });
    expect((await call("POST", `/studio/api/workspaces/${id}/file`, { chapter_id: 999999 }, { cookie })).status).toBe(404);
    expect((await call("POST", "/studio/api/workspaces/999999/file", { chapter_id: 1 }, { cookie })).status).toBe(404);
  });
});
