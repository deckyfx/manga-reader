/**
 * Whether a page has work readers can't see yet, as a recorded fact: `resultSeq` moves with every change to result.png
 * and `publishedSeq` records which of those was published. These pin the cases the old file-time guess got wrong or
 * only got right by faking timestamps, and the one-time handover from that guess.
 */
import { describe, expect, test } from "bun:test";
import { copyFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { pages } from "@/db/schema";
import { historyFile, hasUnpublishedEdits } from "@/services/page-history";
import { adoptLegacyProvenance } from "@/services/publish-provenance";
import { pageDir, PageStore } from "@/stores/page-store";
import { WorkspaceStore } from "@/stores/workspace-store";
import { call, png, signedIn } from "./harness";

/** A chapter with one page, as a contributor would make it. */
async function chapterPage(cookie: string): Promise<{ chapterId: number; pageId: string }> {
  const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Provenance ${crypto.randomUUID()}` }, { cookie });
  const chapter = await call<{ chapter_id: number }>("POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "One" }, { cookie });
  const chapterId = chapter.body.chapter_id;
  const form = new FormData();
  form.append("files", new File([await png()], "1.png", { type: "image/png" }));
  await call("POST", `/manage/api/chapters/${chapterId}/pages`, form, { cookie });
  const [page] = await PageStore.listByChapter(chapterId);
  return { chapterId, pageId: page.id };
}

/** A render, as the pipeline's render stage records it. */
async function burn(pageId: string): Promise<void> {
  await copyFile(join(pageDir(pageId), "original.png"), join(pageDir(pageId), "result.png"));
  await PageStore.noteResultChanged(pageId);
}

async function hasWork(pageId: string): Promise<boolean> {
  const page = await PageStore.findById(pageId);
  return page !== undefined && hasUnpublishedEdits(page);
}

describe("unpublished work", () => {
  test("a render is unpublished until it is published, and published after", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageId } = await chapterPage(cookie);
    // A page is published the moment it arrives translated; this one arrived raw
    expect(await hasWork(pageId)).toBe(false);

    await burn(pageId);
    expect(await hasWork(pageId)).toBe(true);
    expect((await call("POST", `/manage/api/pages/${pageId}/publish`, undefined, { cookie })).status).toBe(200);
    expect(await hasWork(pageId)).toBe(false);
  });

  test("a draft of a published page has nothing to publish until it is edited, and nothing once published over it", async () => {
    const { cookie } = await signedIn("contributor");
    const { chapterId, pageId: origin } = await chapterPage(cookie);
    await burn(origin);
    await call("POST", `/manage/api/pages/${origin}/publish`, undefined, { cookie });

    const sent = await call<{ workspace_id: number }>("POST", `/manage/api/chapters/${chapterId}/to-studio`, undefined, { cookie });
    const draft = (await WorkspaceStore.pages(sent.body.workspace_id)).find((page) => page.originPageId === origin);
    expect(draft).toBeDefined();
    // A fresh copy is exactly what readers already have — the file-time guess called this "edited", since a copy is
    // written now
    expect(await hasWork(draft!.id)).toBe(false);

    await burn(draft!.id);
    expect(await hasWork(draft!.id)).toBe(true);
    const published = await call("POST", `/studio/api/pages/${draft!.id}/publish`, undefined, { cookie });
    expect(published.status).toBe(200);
    expect(await hasWork(draft!.id)).toBe(false);
    expect(await hasWork(origin)).toBe(false);
  });

  test("a draft of a page with unpublished work starts with that work to publish", async () => {
    const { cookie } = await signedIn("contributor");
    const { chapterId, pageId: origin } = await chapterPage(cookie);
    await burn(origin);

    const sent = await call<{ workspace_id: number }>("POST", `/manage/api/chapters/${chapterId}/to-studio`, undefined, { cookie });
    const draft = (await WorkspaceStore.pages(sent.body.workspace_id)).find((page) => page.originPageId === origin);
    expect(await hasWork(draft!.id)).toBe(true);
  });

  test("rolling back publishes the old image, leaving nothing unpublished", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageId } = await chapterPage(cookie);
    await burn(pageId);
    await call("POST", `/manage/api/pages/${pageId}/publish`, undefined, { cookie });
    await burn(pageId);
    await call("POST", `/manage/api/pages/${pageId}/publish`, undefined, { cookie });

    const rolled = await call("POST", `/studio/api/pages/${pageId}/rollback`, { revision: 1 }, { cookie });
    expect(rolled.status).toBe(200);
    expect(await hasWork(pageId)).toBe(false);
  });
});

describe("the handover from file times", () => {
  /** Forgets what was recorded, as for a page from before it was. */
  const forget = (pageId: string) => db.update(pages).set({ publishedSeq: null }).where(eq(pages.id, pageId)).run();

  test("keeps a published page published, and an edited one edited", async () => {
    const { cookie } = await signedIn("contributor");
    const published = await chapterPage(cookie);
    await burn(published.pageId);
    await call("POST", `/manage/api/pages/${published.pageId}/publish`, undefined, { cookie });

    const edited = await chapterPage(cookie);
    await burn(edited.pageId);
    await call("POST", `/manage/api/pages/${edited.pageId}/publish`, undefined, { cookie });
    // Burnt again after its publish, and dated so: the old rule's "newer than the snapshot"
    await burn(edited.pageId);
    const later = new Date(Date.now() + 60_000);
    await utimes(join(pageDir(edited.pageId), "result.png"), later, later);
    // …and the published page's burn dated before its snapshot, as a publish leaves it
    const earlier = new Date(Date.now() - 60_000);
    await utimes(join(pageDir(published.pageId), "result.png"), earlier, earlier);
    expect(await Bun.file(historyFile(published.pageId, 1)).exists()).toBe(true);

    forget(published.pageId);
    forget(edited.pageId);
    // Without a record, both read as unpublished — which is why the handover has to run
    expect(await hasWork(published.pageId)).toBe(true);

    await adoptLegacyProvenance();
    expect(await hasWork(published.pageId)).toBe(false);
    expect(await hasWork(edited.pageId)).toBe(true);
  });
});
