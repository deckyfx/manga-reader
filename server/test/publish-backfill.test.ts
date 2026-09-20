/**
 * The backfill for pages burnt before publishing existed, and the reader rule it lets us keep.
 *
 * The rule: a reader is served a published snapshot or the original, never a burn. Before the backfill the reader
 * fell back to `result.png`, which leaked unpublished Studio work; these tests pin down both halves.
 */
import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, utimes } from "node:fs/promises";

import { join } from "node:path";
import { pageImagePath } from "@/plugins/read/index";
import { hasUnpublishedEditsAgainst, publishedFile } from "@/services/page-history";
import { backfillPublishes, pagesNeedingPublish } from "@/services/publish-backfill";
import { pageDir, PageStore } from "@/stores/page-store";
import { WorkspaceStore } from "@/stores/workspace-store";
import { call, png, signedIn } from "./harness";

/** A chapter with `count` pages filed into it, as an import would leave them: originals, nothing burnt. */
async function chapterWithPages(cookie: string, count: number): Promise<{ chapterId: number; pageIds: string[] }> {
  const series = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Backfill ${crypto.randomUUID()}` }, { cookie });
  const chapter = await call<{ unsorted: { id: number }[] }>(
    "POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "Chapter 1" }, { cookie },
  );
  const chapterId = chapter.body.unsorted[0]!.id;

  const form = new FormData();
  for (let i = 0; i < count; i++) {
    form.append("files", new File([await png(`#33${(i * 30 + 40).toString(16)}99`)], `${i + 1}.png`, { type: "image/png" }));
  }
  await call("POST", `/manage/api/chapters/${chapterId}/pages`, form, { cookie });
  const pages = await PageStore.listByChapter(chapterId);
  return { chapterId, pageIds: pages.map((page) => page.id) };
}

/** Puts a burnt result next to the original, the way the pipeline's render stage would, without publishing it. */
async function burn(pageId: string): Promise<void> {
  await copyFile(join(pageDir(pageId), "original.png"), join(pageDir(pageId), "result.png"));
}

/** Ages a file by `days`, so "burnt long ago" can be told apart from "burnt just now". */
async function backdate(file: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await utimes(file, when, when);
}

describe("what a reader is served", () => {
  test("a burn nobody published is not served; the original is", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageIds } = await chapterWithPages(cookie, 1);
    const [pageId] = pageIds;
    await burn(pageId);

    expect(publishedFile(pageId)).toBeNull();
    expect(pageImagePath(pageId)).toBe(join(pageDir(pageId), "original.png"));
  });

  test("once published, the snapshot is served rather than the burn", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageIds } = await chapterWithPages(cookie, 1);
    const [pageId] = pageIds;
    await burn(pageId);

    expect((await call("POST", `/manage/api/pages/${pageId}/publish`, undefined, { cookie })).status).toBe(200);
    const served = pageImagePath(pageId);
    expect(served).toBe(publishedFile(pageId));
    expect(served).not.toBe(join(pageDir(pageId), "result.png"));
  });
});

describe("the backfill", () => {
  test("publishes chapter pages that hold an unpublished burn, and leaves the rest alone", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageIds } = await chapterWithPages(cookie, 3);
    const [burnt, alsoBurnt, untouched] = pageIds;
    await burn(burnt);
    await burn(alsoBurnt);

    const pending = await pagesNeedingPublish();
    expect(pending).toContain(burnt);
    expect(pending).toContain(alsoBurnt);
    // Nothing was burnt for this one, so there is nothing to publish
    expect(pending).not.toContain(untouched);

    const report = await backfillPublishes();
    expect(report.failed).toEqual([]);
    expect(report.published).toContain(burnt);
    expect(publishedFile(burnt)).not.toBeNull();
    expect(publishedFile(untouched)).toBeNull();
    expect(pageImagePath(burnt)).toBe(publishedFile(burnt));
  });

  test("running it again publishes nothing new", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageIds } = await chapterWithPages(cookie, 1);
    await burn(pageIds[0]);

    expect((await backfillPublishes()).published).toContain(pageIds[0]);
    const second = await backfillPublishes();
    expect(second.published).not.toContain(pageIds[0]);
    expect(second.failed).toEqual([]);
  });

  test("it leaves an already-published page on the revision it had", async () => {
    const { cookie } = await signedIn("contributor");
    const { pageIds } = await chapterWithPages(cookie, 1);
    const [pageId] = pageIds;
    await burn(pageId);
    await call("POST", `/manage/api/pages/${pageId}/publish`, undefined, { cookie });
    const before = await PageStore.findById(pageId);

    await backfillPublishes();
    const after = await PageStore.findById(pageId);
    expect(after?.revision).toBe(before!.revision);
  });

  test("an Inbox draft holding a burn is none of its business", async () => {
    // Straight to the store: the pipeline route needs models, and what matters here is a page nobody can read
    const { page } = await PageStore.findOrCreate(`hash-${crypto.randomUUID()}`, "upload");
    await mkdir(pageDir(page.id), { recursive: true });
    await Bun.write(join(pageDir(page.id), "original.png"), await png());
    await burn(page.id);

    expect(page.chapterId).toBeNull();
    expect(await pagesNeedingPublish()).not.toContain(page.id);
  });
});

describe("the backfill and Studio drafts", () => {
  test("a draft rendered after the origin's burn still counts as having work to publish", async () => {
    const { cookie } = await signedIn("contributor");
    const { chapterId, pageIds } = await chapterWithPages(cookie, 1);
    const [origin] = pageIds;
    // An old burn on the chapter page: the kind of page the backfill exists for
    await burn(origin);
    await backdate(join(pageDir(origin), "result.png"), 14);

    const sent = await call<{ workspace_id: number }>("POST", `/manage/api/chapters/${chapterId}/to-studio`, undefined, { cookie });
    expect(sent.status).toBe(200);
    const drafts = await WorkspaceStore.pages(sent.body.workspace_id);
    const draft = drafts.find((page) => page.originPageId === origin);
    expect(draft).toBeDefined();

    // Somebody edits and re-renders the draft today
    await burn(draft!.id);
    expect(hasUnpublishedEditsAgainst(draft!.id, origin)).toBe(true);

    const report = await backfillPublishes();
    expect(report.published).toContain(origin);

    // The snapshot records a fortnight-old burn, so the draft's work is still newer — and still offered
    expect(hasUnpublishedEditsAgainst(draft!.id, origin)).toBe(true);
  });
});

describe("who may run it", () => {
  test("an admin may; a contributor may not; a key never may", async () => {
    const admin = await signedIn("admin");
    const contributor = await signedIn("contributor");

    expect((await call("GET", "/manage/api/publish-backfill", undefined, { cookie: admin.cookie })).status).toBe(200);
    expect((await call("POST", "/manage/api/publish-backfill", undefined, { cookie: admin.cookie })).status).toBe(200);
    expect((await call("POST", "/manage/api/publish-backfill", undefined, { cookie: contributor.cookie })).status).toBe(403);
    expect((await call("POST", "/manage/api/publish-backfill")).status).toBe(401);
  });
});
