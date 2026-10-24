/**
 * What may be published: the gate between the Studio and what readers (and open extension tabs) are given.
 *
 * Three refusals — still being translated, nothing rendered, rendered before the latest edit — and the one
 * deliberate exception, rollback, which publishes an older snapshot although it no longer matches the blocks.
 * "Nothing rendered" is also pinned in workspaces.test.ts, for a draft; here it is the plain page.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { publishBlocker } from "@/services/draft-publish";
import { PageStore, pageDir } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

/** A Studio page with one block, its render fresh and a result on disk, as if just burned. */
async function renderedPage(cookie: string): Promise<string> {
  const workspace = await call<{ id: number }>("POST", "/studio/api/workspaces", { name: `Gate ${crypto.randomUUID()}` }, { cookie });
  const form = new FormData();
  form.append("files", new File([await png("#ffffff", 120, 160)], "1.png", { type: "image/png" }));
  form.append("start_index", "0");
  const upload = await call<{ pages: { id: string }[] }>("POST", `/studio/api/workspaces/${workspace.body.id}/pages`, form, { cookie });
  const pageId = upload.body.pages[0]!.id;
  await call("POST", `/studio/api/pages/${pageId}/blocks`, { kind: "text", x: 10, y: 10, w: 60, h: 40, source_text: "あ", translated_text: "A" }, { cookie });
  await burn(pageId, "#334455");
  return pageId;
}

/** What the render stage leaves behind: a result, recorded as changed, and the stage fresh. */
async function burn(pageId: string, colour: string): Promise<void> {
  await Bun.write(join(pageDir(pageId), "result.png"), await png(colour, 120, 160));
  await PageStore.noteResultChanged(pageId);
  await PageStore.setStage(pageId, "render", "fresh");
}

const publish = (pageId: string, cookie: string) =>
  call<{ revision?: number; error?: string }>("POST", `/studio/api/pages/${pageId}/publish`, undefined, { cookie });

describe("the publish gate", () => {
  test("a page rendered after its last edit is published, and each publish is a new revision", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await renderedPage(cookie);
    expect(await publish(pageId, cookie)).toMatchObject({ status: 200, body: { revision: 1 } });
    await burn(pageId, "#556677");
    expect(await publish(pageId, cookie)).toMatchObject({ status: 200, body: { revision: 2 } });
  });

  test("an edit since the render holds the publish back until it is rendered again", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await renderedPage(cookie);
    // The result on disk still says "A": publishing it would hand readers the old text under the new one's name
    await call("PATCH", `/studio/api/pages/${pageId}/blocks/1`, { translated_text: "B" }, { cookie });

    const held = await publish(pageId, cookie);
    expect([held.status, held.body.error]).toEqual([409, "the page changed since it was last rendered — re-render before publishing"]);
    expect((await PageStore.findById(pageId))?.revision ?? 0).toBe(0);

    await burn(pageId, "#667788");
    expect(await publish(pageId, cookie)).toMatchObject({ status: 200, body: { revision: 1 } });
  });

  test("a page with no result has nothing to publish", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await renderedPage(cookie);
    await Bun.file(join(pageDir(pageId), "result.png")).delete();
    const refused = await publish(pageId, cookie);
    expect([refused.status, refused.body.error]).toEqual([409, "page has no result to publish"]);
  });

  test("a page still being translated is refused, whatever its last result was", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await renderedPage(cookie);
    for (const status of ["queued", "running"] as const) {
      await PageStore.update(pageId, { status });
      const refused = await publish(pageId, cookie);
      expect([status, refused.status, refused.body.error]).toEqual([status, 409, "page is still being translated"]);
    }
  });

  test("rollback is the exception: it publishes an older snapshot though the blocks no longer match it", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await renderedPage(cookie);
    await publish(pageId, cookie);
    await burn(pageId, "#778899");
    await publish(pageId, cookie);

    const rolledBack = await call<{ revision: number }>("POST", `/studio/api/pages/${pageId}/rollback`, { revision: 1 }, { cookie });
    expect(rolledBack).toMatchObject({ status: 200, body: { revision: 3 } });
    // …and leaves the render stale, so an ordinary publish waits for a fresh one
    const held = await publish(pageId, cookie);
    expect(held.status).toBe(409);
    expect((await call("POST", `/studio/api/pages/${pageId}/rollback`, { revision: 9 }, { cookie })).status).toBe(404);
  });
});

describe("the rule itself", () => {
  // The route turns a page being translated away before asking the rule (editablePage answers first), so these
  // branches only run for the callers that ask the rule directly: publishing or filing a workspace, and the publish
  // backfill at boot. The rule must hold on its own.
  test("refuses a page in progress before it looks at anything on disk", async () => {
    const { cookie } = await signedIn("contributor");
    const pageId = await renderedPage(cookie);
    const page = (await PageStore.findById(pageId))!;
    const stages = await PageStore.listStages(pageId);
    expect(publishBlocker(page, stages)).toBeNull();
    expect(publishBlocker({ ...page, status: "queued" }, stages)).toBe("page is still being translated");
    expect(publishBlocker({ ...page, status: "running" }, stages)).toBe("page is still being translated");
    expect(publishBlocker(page, stages.map((s) => s.stage === "render" ? { ...s, status: "stale" } : s))).toContain("re-render");
    // Another stage out of date doesn't hold a publish back: only what the result was made from does
    expect(publishBlocker(page, [...stages.filter((s) => s.stage !== "translate"), { stage: "translate", status: "stale" }])).toBeNull();
  });
});
