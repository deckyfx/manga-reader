/**
 * Finalizing a page: its working files, stages and blocks go, the final image stays — and, unless it is deleted too,
 * the original, so the page can be redone. Decided with the user on 2026-09-14 (TODO.txt).
 */
import { describe, expect, test } from "bun:test";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { historyFile } from "@/services/page-history";
import { pageDir, PageStore } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

/** A Studio page with a block, working files and a burnt result, as a translated page has. */
async function workedPage(cookie: string): Promise<string> {
  const workspace = await call<{ id: number }>("POST", "/studio/api/workspaces", { name: `Finalize ${crypto.randomUUID()}` }, { cookie });
  const form = new FormData();
  form.append("files", new File([await png("#ffffff", 200, 300)], "1.png", { type: "image/png" }));
  form.append("start_index", "0");
  const upload = await call<{ pages: { id: string }[] }>("POST", `/studio/api/workspaces/${workspace.body.id}/pages`, form, { cookie });
  const pageId = upload.body.pages[0]!.id;
  await call("POST", `/studio/api/pages/${pageId}/blocks`, { kind: "text", x: 10, y: 10, w: 50, h: 40, source_text: "a", translated_text: "b" }, { cookie });
  const dir = pageDir(pageId);
  for (const file of ["mask.png", "overlay.png", "clean-text.png", "render-overlay.png", "result.png"]) {
    await copyFile(join(dir, "original.png"), join(dir, file));
  }
  await mkdir(join(dir, "crops"), { recursive: true });
  await copyFile(join(dir, "original.png"), join(dir, "crops", "1.png"));
  await PageStore.noteResultChanged(pageId);
  await PageStore.setStage(pageId, "render", "fresh");
  return pageId;
}

const finalize = (cookie: string, ids: string[], options: { delete_raw?: boolean; dry_run?: boolean } = {}) =>
  call<{ pages: { id: string; ok: boolean; reason: string | null; files: string[]; bytes: number }[]; bytes: number }>(
    "POST", "/studio/api/pages/finalize", { ids, ...options }, { cookie },
  );

describe("finalizing", () => {
  test("a dry run says what would go and how much it frees, and changes nothing", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await workedPage(cookie);
    const plan = await finalize(cookie, [pageId], { dry_run: true });
    expect(plan.status).toBe(200);
    const [entry] = plan.body.pages;
    expect(entry).toMatchObject({ id: pageId, ok: true, reason: null });
    expect(entry!.files).toEqual(["clean-text.png", "crops/1.png", "mask.png", "overlay.png", "render-overlay.png"]);
    expect(entry!.bytes).toBeGreaterThan(0);
    expect(existsSync(join(pageDir(pageId), "mask.png"))).toBe(true);
    expect((await PageStore.findById(pageId))?.finalizedAt).toBeNull();
  });

  test("keeps the result and the original, removes the rest, and flags the page", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await workedPage(cookie);
    const done = await finalize(cookie, [pageId]);
    expect(done.body.pages[0]?.ok).toBe(true);

    const dir = pageDir(pageId);
    expect(existsSync(join(dir, "result.png"))).toBe(true);
    expect(existsSync(join(dir, "original.png"))).toBe(true);
    for (const gone of ["mask.png", "overlay.png", "clean-text.png", "render-overlay.png", "crops"]) expect(existsSync(join(dir, gone))).toBe(false);

    const detail = await call<{ page: { finalized: boolean; raw_kept: boolean; has_edits: boolean }; stages: unknown[]; blocks: unknown[] }>(
      "GET", `/studio/api/pages/${pageId}`, undefined, { cookie },
    );
    expect(detail.body.page).toMatchObject({ finalized: true, raw_kept: true, has_edits: false });
    expect(detail.body.stages).toEqual([]);
    expect(detail.body.blocks).toEqual([]);
  });

  test("a finalized page can't be edited, but one that kept its original can be redone", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await workedPage(cookie);
    await finalize(cookie, [pageId]);
    const edit = await call("POST", `/studio/api/pages/${pageId}/blocks`, { kind: "text", x: 1, y: 1, w: 20, h: 20 }, { cookie });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toContain("redo");
    // Redo is "run again": refused here only because the test server has no models, not because it is finalized
    const redo = await call("POST", `/studio/api/pages/${pageId}/rerun`, {}, { cookie });
    expect(redo.status).not.toBe(409);
  });

  test("deleting the original too makes the page read-only and forgets the image", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await workedPage(cookie);
    const page = await PageStore.findById(pageId);
    await finalize(cookie, [pageId], { delete_raw: true });
    expect(existsSync(join(pageDir(pageId), "original.png"))).toBe(false);
    expect(existsSync(join(pageDir(pageId), "result.png"))).toBe(true);

    const redo = await call("POST", `/studio/api/pages/${pageId}/rerun`, {}, { cookie });
    expect(redo.status).toBe(409);
    expect(redo.body.error).toContain("without its original");

    // Moved out of the workspace so it is loose, the only kind the extension's image lookup reuses
    await PageStore.update(pageId, { workspaceId: null });
    const again = await PageStore.findOrCreate(page!.imageHash, page!.source);
    expect(again.page.id).not.toBe(pageId);
    expect(again.created).toBe(true);
  });

  test("a published page keeps the snapshot readers are served; older ones go", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await workedPage(cookie);
    await call("POST", `/studio/api/pages/${pageId}/publish`, undefined, { cookie });
    await PageStore.noteResultChanged(pageId);
    await call("POST", `/studio/api/pages/${pageId}/publish`, undefined, { cookie });
    expect((await PageStore.findById(pageId))?.revision).toBe(2);

    await finalize(cookie, [pageId]);
    expect(existsSync(historyFile(pageId, 2))).toBe(true);
    expect(existsSync(historyFile(pageId, 1))).toBe(false);
  });

  test("refuses a page with unpublished edits, and one with nothing finished yet — and says why", async () => {
    const { cookie } = await signedIn("contributor");
    const edited = await workedPage(cookie);
    await call("POST", `/studio/api/pages/${edited}/publish`, undefined, { cookie });
    await PageStore.noteResultChanged(edited);

    const bare = await workedPage(cookie);
    await Bun.file(join(pageDir(bare), "result.png")).delete();

    const result = await finalize(cookie, [edited, bare]);
    expect(result.body.pages.map((p) => [p.ok, p.reason?.split(" ").slice(0, 3).join(" ")])).toEqual([
      [false, "it has edits"],
      [false, "it has no"],
    ]);
    expect((await PageStore.findById(edited))?.finalizedAt).toBeNull();
  });

  test("batch runs pass finalized pages by, even when forced", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await workedPage(cookie);
    await finalize(cookie, [pageId]);
    const { pagesNeedingRun } = await import("@/services/page-batch");
    const page = await PageStore.findById(pageId);
    expect(await pagesNeedingRun([page!], true)).toEqual([]);
  });
});
