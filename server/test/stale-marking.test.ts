/**
 * Edits mark the stages after them stale, so the Studio asks for a re-render — but only when something changed. A
 * field saved back as it was (a blur on an untouched box, the same style again) must leave the stages alone.
 */
import { describe, expect, test } from "bun:test";
import { PageStore } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

/** A Studio page with one text block, its render marked fresh as if just burned. */
async function pageWithBlock(cookie: string): Promise<{ pageId: string }> {
  const workspace = await call<{ id: number }>("POST", "/studio/api/workspaces", { name: `Stale ${crypto.randomUUID()}` }, { cookie });
  const form = new FormData();
  form.append("files", new File([await png("#ffffff", 200, 300)], "1.png", { type: "image/png" }));
  form.append("start_index", "0");
  const upload = await call<{ pages: { id: string }[] }>("POST", `/studio/api/workspaces/${workspace.body.id}/pages`, form, { cookie });
  const pageId = upload.body.pages[0]!.id;
  const made = await call("POST", `/studio/api/pages/${pageId}/blocks`, {
    kind: "text", x: 20, y: 20, w: 80, h: 60, source_text: "こんにちは", translated_text: "Hello", style: { font_size: 14, uppercase: false },
  }, { cookie });
  expect(made.status).toBe(200);
  for (const stage of ["translate", "render"] as const) await PageStore.setStage(pageId, stage, "fresh");
  return { pageId };
}

const stageStatus = async (pageId: string, stage: string) => (await PageStore.listStages(pageId)).find((s) => s.stage === stage)?.status;

/** Block 1's own flags, as the page editor gets them. */
async function blockFlags(pageId: string, cookie: string): Promise<{ needs_translate: boolean; needs_render: boolean }> {
  const detail = await call<{ blocks: { id: number; needs_translate: boolean; needs_render: boolean }[] }>("GET", `/studio/api/pages/${pageId}`, undefined, { cookie });
  const block = detail.body.blocks.find((b) => b.id === 1)!;
  return { needs_translate: block.needs_translate, needs_render: block.needs_render };
}

/** Clears block 1's flags, as a translate and a render of it would. */
async function settle(pageId: string): Promise<void> {
  const job = await PageStore.readJob(pageId);
  for (const b of job!.blocks) b.needs_translate = b.needs_render = false;
  PageStore.writeJob(pageId, job!);
}

describe("which block is out of date", () => {
  test("each block says what it needs: a new translation, or just burning again", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageId } = await pageWithBlock(cookie);
    // Drawn with its text and translation: it needs burning, not translating
    expect(await blockFlags(pageId, cookie)).toEqual({ needs_translate: false, needs_render: true });

    await settle(pageId);
    await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, { translated_text: "Hello", style: { uppercase: false, font_size: 14 } }, { cookie });
    expect(await blockFlags(pageId, cookie)).toEqual({ needs_translate: false, needs_render: false });

    await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, { translated_text: "Hi" }, { cookie });
    expect(await blockFlags(pageId, cookie)).toEqual({ needs_translate: false, needs_render: true });

    await settle(pageId);
    await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, { source_text: "さようなら" }, { cookie });
    expect(await blockFlags(pageId, cookie)).toEqual({ needs_translate: true, needs_render: true });
  });
});

describe("stale marking", () => {
  test("saving a block back unchanged leaves the render fresh", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageId } = await pageWithBlock(cookie);
    // Same text, and the same style with its keys in another order
    const saved = await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, {
      source_text: "こんにちは", translated_text: "Hello", style: { uppercase: false, font_size: 14 },
    }, { cookie });
    expect(saved.status).toBe(200);
    expect(await stageStatus(pageId, "translate")).toBe("fresh");
    expect(await stageStatus(pageId, "render")).toBe("fresh");
  });

  test("a real change still marks what it affects", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageId } = await pageWithBlock(cookie);
    await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, { translated_text: "Hi there" }, { cookie });
    expect(await stageStatus(pageId, "translate")).toBe("fresh");
    expect(await stageStatus(pageId, "render")).toBe("stale");

    await PageStore.setStage(pageId, "render", "fresh");
    await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, { source_text: "さようなら" }, { cookie });
    expect(await stageStatus(pageId, "translate")).toBe("stale");
    expect(await stageStatus(pageId, "render")).toBe("stale");
  });

  test("a changed style marks the render, an unchanged one doesn't", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageId } = await pageWithBlock(cookie);
    await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, { style: { font_size: 18, uppercase: false } }, { cookie });
    expect(await stageStatus(pageId, "render")).toBe("stale");
  });
});
