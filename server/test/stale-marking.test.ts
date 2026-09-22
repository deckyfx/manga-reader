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
