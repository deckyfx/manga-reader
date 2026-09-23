import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import { existsSync } from "node:fs";
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/db/index";
import { env } from "@/env";
import { childLogger } from "@/lib/logger";
import { pageBlocks, pages, pageStages, type NewPage, type Page, type PageStageRow } from "@/db/schema";
import type { BlockShape, JobRepository, PageBlock, PageJob } from "@/services/page-pipeline";
import type { StoredArea, TextStyle } from "@/shared/typeset";

const log = childLogger("page-store");

/** Rectangles are the default, so only ellipse / polygon outlines are stored. */
const shapeToJson = (shape: BlockShape | undefined): string | null =>
  shape && shape.type !== "rect" ? JSON.stringify(shape) : null;

/** Geometry of a block drawn or reshaped in the Studio. */
export interface BlockGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: BlockShape;
}

/** Stage images of every page live in `<PAGE_JOBS_DIR>/<page id>/`. */
export const PAGE_JOBS_DIR = `${env.DATA_DIR}/jobs`;

export const STAGE_NAMES = ["detect", "ocr", "translate", "clean_text", "clean_sfx", "render"] as const;
export type StageName = (typeof STAGE_NAMES)[number];
export type StageStatus = "fresh" | "stale" | "error";

/** Image each stage produces, shown by the Studio's stage viewer. */
export const STAGE_FILES: Record<StageName, string | null> = {
  detect: "overlay.png",
  ocr: null,
  translate: null,
  clean_text: "clean-text.png",
  clean_sfx: "clean-sfx.png",
  render: "result.png",
};

/** Folder holding a page's stage images. */
export const pageDir = (id: string): string => join(PAGE_JOBS_DIR, id);

type RenderInfo = NonNullable<PageBlock["render"]>;

/** A write transaction (bun-sqlite transactions are synchronous). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Marks stages stale inside a transaction, so a block edit and its invalidation commit or roll back together. */
function markStaleIn(tx: Tx, pageId: string, stages: readonly StageName[]): void {
  if (stages.length === 0) return;
  tx.update(pageStages)
    .set({ status: "stale", updatedAt: sql`(datetime('now'))` })
    .where(and(eq(pageStages.pageId, pageId), inArray(pageStages.stage, [...stages])))
    .run();
}

/** Folder name of a deleted page whose cleanup is pending: `<page id>.deleting-<timestamp>`. */
const PARKED_FOLDER = /^[A-Za-z0-9-]+\.deleting-\d+$/;

/** Pages, their stage state and blocks. SQLite is the source of truth; the page folder only holds images. */
export class PageStore {
  static async list(limit = 100): Promise<Page[]> {
    return db.select().from(pages).orderBy(desc(pages.updatedAt)).limit(limit);
  }

  static async findById(id: string): Promise<Page | undefined> {
    return db.query.pages.findFirst({ where: eq(pages.id, id) });
  }

  /**
   * The Inbox page for an image, created if there is none. Only Inbox pages (no chapter) are reused: the same image
   * filed into chapters keeps its own page per chapter, so edits there are independent.
   *
   * `image_hash` stopped being unique in migration 0006 (an image may appear in several chapters), so two requests for
   * the same new image at the same instant can end up with two drafts. That costs a duplicate draft in the Inbox and
   * nothing more — each is a complete page — so it is left unguarded rather than serialised.
   */
  static async findOrCreate(imageHash: string, source: string): Promise<{ page: Page; created: boolean }> {
    // Loose only: a workspace's page belongs to that workspace, and must not be handed back to the extension
    // A page finalized without its original can't be redone, so it no longer stands for this image: a new one starts
    const inbox = and(eq(pages.imageHash, imageHash), isNull(pages.chapterId), isNull(pages.workspaceId), eq(pages.rawDeleted, false));
    const existing = await db.query.pages.findFirst({ where: inbox, orderBy: desc(pages.createdAt) });
    if (existing) return { page: existing, created: false };
    const [row] = await db.insert(pages).values({ id: randomUUIDv7(), imageHash, source }).returning();
    if (!row) throw new Error("failed to create page");
    return { page: row, created: true };
  }

  /** A page filed straight into a chapter (ZIP or image import); never reuses an existing page. */
  static async createInChapter(imageHash: string, source: string, chapterId: number, sortOrder: number, name: string | null): Promise<Page> {
    const [row] = await db.insert(pages).values({ id: randomUUIDv7(), imageHash, source, chapterId, sortOrder, name }).returning();
    if (!row) throw new Error("failed to create page");
    return row;
  }

  /**
   * A page appended to a Studio workspace at `sortOrder` (its import position); never reuses an existing page.
   * `originPageId` marks it as a draft copy of a chapter page, which it replaces when it is published.
   */
  static async createInWorkspace(
    imageHash: string,
    source: string,
    workspaceId: number,
    sortOrder: number,
    name: string | null,
    originPageId: string | null = null,
  ): Promise<Page> {
    const [row] = await db.insert(pages).values({ id: randomUUIDv7(), imageHash, source, workspaceId, sortOrder, name, originPageId }).returning();
    if (!row) throw new Error("failed to create page");
    return row;
  }

  /**
   * Pages for the Studio's list: the Inbox, the pages inside chapters, or both, newest first. `search` matches the
   * page name and its source.
   */
  static async listFiltered(options: { filed?: "inbox" | "chapter" | "all"; chapterId?: number; search?: string; limit?: number } = {}): Promise<Page[]> {
    const filters = [];
    if (options.chapterId !== undefined) filters.push(eq(pages.chapterId, options.chapterId));
    // Pages in a workspace are listed with it, not among the loose ones. A chapter-scoped query still returns them:
    // asking for a chapter's pages means all of them, wherever they are being worked on.
    else if (options.filed === "inbox") filters.push(isNull(pages.chapterId), isNull(pages.workspaceId));
    else if (options.filed === "all") filters.push(isNull(pages.workspaceId));
    else if (options.filed === "chapter") filters.push(isNotNull(pages.chapterId));
    const search = options.search?.trim();
    if (search) {
      const like = `%${search.replace(/[%_]/g, (char) => `\\${char}`)}%`;
      filters.push(sql`(${pages.name} LIKE ${like} ESCAPE '\\' OR ${pages.source} LIKE ${like} ESCAPE '\\')`);
    }
    return db
      .select()
      .from(pages)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(pages.updatedAt))
      .limit(options.limit ?? 100);
  }

  /** Copies a page's stage state and blocks onto another page, replacing whatever that one had. */
  static async copyStagesAndBlocks(fromId: string, toId: string): Promise<void> {
    const [stages, blocks] = await Promise.all([
      db.select().from(pageStages).where(eq(pageStages.pageId, fromId)),
      db.select().from(pageBlocks).where(eq(pageBlocks.pageId, fromId)),
    ]);
    db.transaction((tx) => {
      tx.delete(pageStages).where(eq(pageStages.pageId, toId)).run();
      tx.delete(pageBlocks).where(eq(pageBlocks.pageId, toId)).run();
      for (const stage of stages) {
        tx.insert(pageStages).values({ ...stage, pageId: toId }).run();
      }
      for (const block of blocks) {
        tx.insert(pageBlocks).values({ ...block, pageId: toId }).run();
      }
    });
  }

  /**
   * Pages of a chapter in reading order. Nothing stops two pages sharing a `sort_order` (appends race, imports
   * number themselves), and `created_at` is only second-precision, so the id settles any tie: the order a reader
   * sees is then always the same one.
   */
  static async listByChapter(chapterId: number): Promise<Page[]> {
    return db.select().from(pages).where(eq(pages.chapterId, chapterId)).orderBy(pages.sortOrder, pages.createdAt, pages.id);
  }

  /**
   * Pages not filed into a chapter yet (extension jobs and uploads), newest first. Workspace pages are left out, as
   * in the Studio's list: they are filed with their workspace, not one at a time.
   */
  static async listInbox(): Promise<Page[]> {
    return db.select().from(pages).where(and(isNull(pages.chapterId), isNull(pages.workspaceId))).orderBy(desc(pages.createdAt));
  }

  /**
   * Every page that belongs to a chapter, oldest first and with no limit. Only the publish backfill wants this: it
   * has to consider the whole library once, rather than a page of it.
   */
  static async listAllInChapters(): Promise<Page[]> {
    return db.select().from(pages).where(isNotNull(pages.chapterId)).orderBy(pages.createdAt, pages.id);
  }

  /** How many pages each of these chapters holds. */
  static async countsByChapter(chapterIds: number[]): Promise<Map<number, number>> {
    if (chapterIds.length === 0) return new Map();
    const rows = await db
      .select({ chapterId: pages.chapterId, count: sql<number>`count(*)` })
      .from(pages)
      .where(inArray(pages.chapterId, chapterIds))
      .groupBy(pages.chapterId);
    return new Map(rows.flatMap((r) => (r.chapterId === null ? [] : [[r.chapterId, Number(r.count)] as const])));
  }

  /** Highest sort order in a chapter (0 when empty), so imports append. */
  static async maxSortOrder(chapterId: number): Promise<number> {
    const row = await db
      .select({ max: sql<number>`coalesce(max(${pages.sortOrder}), 0)` })
      .from(pages)
      .where(eq(pages.chapterId, chapterId))
      .get();
    return row?.max ?? 0;
  }

  /** Moves a page into a chapter (null = back to the Inbox), optionally renaming it. False when it doesn't exist. */
  static async filePage(id: string, fields: { chapterId?: number | null; sortOrder?: number; name?: string | null }): Promise<boolean> {
    const rows = await db
      .update(pages)
      .set({ ...fields, updatedAt: sql`(datetime('now'))` })
      .where(eq(pages.id, id))
      .returning({ id: pages.id });
    return rows.length > 0;
  }

  /** Writes a chapter's reading order from the given page ids, in one transaction. */
  static async reorderChapter(chapterId: number, orderedIds: string[]): Promise<void> {
    db.transaction((tx) => {
      orderedIds.forEach((id, index) => {
        tx.update(pages)
          .set({ sortOrder: index + 1, updatedAt: sql`(datetime('now'))` })
          .where(and(eq(pages.id, id), eq(pages.chapterId, chapterId)))
          .run();
      });
    });
  }

  static async update(id: string, data: Partial<Omit<NewPage, "id" | "imageHash">>): Promise<void> {
    await db.update(pages).set({ ...data, updatedAt: sql`(datetime('now'))` }).where(eq(pages.id, id));
  }

  /**
   * Marks pages left queued or running by a previous server process as failed (jobs live in memory, so they
   * can't resume). Call once at boot; returns how many pages were affected.
   */
  static async failInterrupted(): Promise<number> {
    const rows = await db
      .update(pages)
      .set({ status: "error", errorMessage: "Interrupted by a server restart — run the page again", updatedAt: sql`(datetime('now'))` })
      .where(inArray(pages.status, ["queued", "running"]))
      .returning({ id: pages.id });
    return rows.length;
  }

  /**
   * Cleans up folders parked by DELETE /studio/api/pages/:id (`<page id>.deleting-<timestamp>`, direct entries of the
   * jobs directory only). A folder whose page row is gone is removed; one whose page row still exists (the server
   * stopped mid-delete) is renamed back so the page keeps its files. Returns how many were removed.
   */
  static async sweepDeletedPageFolders(): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(PAGE_JOBS_DIR);
    } catch {
      return 0;
    }
    const parked = entries.filter((name) => PARKED_FOLDER.test(name));
    // One folder that can't be handled must not stop the others, or the server from starting; it's retried next start
    const results = await Promise.allSettled(parked.map(async (name): Promise<"removed" | "restored" | "kept"> => {
      const pageId = name.slice(0, name.lastIndexOf(".deleting-"));
      const parkedPath = join(PAGE_JOBS_DIR, name);
      if (await PageStore.findById(pageId)) {
        // The server stopped between moving the folder aside and deleting the row: the page still exists, so its
        // files go back instead of being deleted
        if (existsSync(pageDir(pageId))) {
          log.warn({ folder: name, pageId }, "Parked folder belongs to a page that already has a folder; leaving both for manual review");
          return "kept";
        }
        await rename(parkedPath, pageDir(pageId));
        log.info({ pageId }, "Restored the folder of a page whose deletion didn't finish");
        return "restored";
      }
      await rm(parkedPath, { recursive: true, force: true });
      return "removed";
    }));
    results.forEach((result, i) => {
      if (result.status === "rejected") log.warn({ err: result.reason, folder: parked[i] }, "Couldn't clean up a deleted page's folder; will retry at next start");
    });
    return results.filter((result) => result.status === "fulfilled" && result.value === "removed").length;
  }

  /** Deletes a page row; its stages and blocks go with it (foreign keys cascade). False when it didn't exist. */
  static async deletePage(id: string): Promise<boolean> {
    const rows = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
    return rows.length > 0;
  }

  /** Increments the publish revision and returns the new value. */
  /**
   * Commits a publish: the next revision, and this result recorded as the published one — in one update, so a page
   * can never be on a new revision with its result still counted as unpublished.
   */
  static async bumpRevision(id: string): Promise<number> {
    const [row] = await db
      .update(pages)
      .set({ revision: sql`${pages.revision} + 1`, publishedSeq: sql`${pages.resultSeq}`, updatedAt: sql`(datetime('now'))` })
      .where(eq(pages.id, id))
      .returning({ revision: pages.revision });
    if (!row) throw new Error("page not found");
    return row.revision;
  }

  /**
   * Finalizes a page's row: flagged, and its blocks and stage state gone with the working files they described — in one
   * transaction, so nothing ever sees a finalized page that still claims to have stages to run.
   */
  static markFinalized(id: string, rawDeleted: boolean): void {
    db.transaction((tx) => {
      tx.update(pages).set({ finalizedAt: sql`(datetime('now'))`, rawDeleted, updatedAt: sql`(datetime('now'))` }).where(eq(pages.id, id)).run();
      tx.delete(pageBlocks).where(eq(pageBlocks.pageId, id)).run();
      tx.delete(pageStages).where(eq(pageStages.pageId, id)).run();
    });
  }

  /** A finalized page (original kept) being redone: it is a working page again. */
  static async clearFinalized(id: string): Promise<void> {
    await db.update(pages).set({ finalizedAt: null, updatedAt: sql`(datetime('now'))` }).where(eq(pages.id, id));
  }

  /** Pages whose publish state was never recorded: every page of a library from before it was, and none after. */
  static async listUnrecordedPublishState(): Promise<Page[]> {
    return db.select().from(pages).where(isNull(pages.publishedSeq)).all();
  }

  /** result.png changed (rendered, rolled back, copied onto): its content is new until it is published. */
  static async noteResultChanged(id: string): Promise<void> {
    await db.update(pages).set({ resultSeq: sql`${pages.resultSeq} + 1` }).where(eq(pages.id, id));
  }

  /**
   * Records this page's current result as published without a publish of its own: a draft whose work was just
   * published over its chapter page, or a copy made of something already published.
   */
  static async markResultPublished(id: string): Promise<void> {
    await db.update(pages).set({ publishedSeq: sql`${pages.resultSeq}` }).where(eq(pages.id, id));
  }

  // ── Stages ─────────────────────────────────────────────────────────────────

  static async listStages(pageId: string): Promise<PageStageRow[]> {
    return db.select().from(pageStages).where(eq(pageStages.pageId, pageId));
  }

  static async setStage(pageId: string, stage: StageName, status: StageStatus, errorMessage: string | null = null): Promise<void> {
    const values = { status, file: STAGE_FILES[stage], errorMessage, updatedAt: sql`(datetime('now'))` };
    await db
      .insert(pageStages)
      .values({ pageId, stage, ...values })
      .onConflictDoUpdate({ target: [pageStages.pageId, pageStages.stage], set: values });
  }

  /** Marks stages that already ran as stale, e.g. `render` after a translation was edited. */
  static async markStale(pageId: string, stages: StageName[]): Promise<void> {
    await db
      .update(pageStages)
      .set({ status: "stale", updatedAt: sql`(datetime('now'))` })
      .where(and(eq(pageStages.pageId, pageId), inArray(pageStages.stage, stages)));
  }

  /** Drops all stage state, before a page is run from scratch. */
  static async clearStages(pageId: string): Promise<void> {
    await db.delete(pageStages).where(eq(pageStages.pageId, pageId));
  }

  // ── Blocks ─────────────────────────────────────────────────────────────────

  /** The page as the pipeline sees it, or null before `detect` has stored any blocks. */
  static async readJob(pageId: string): Promise<PageJob | null> {
    const page = await PageStore.findById(pageId);
    if (!page || page.width === 0) return null;
    const rows = await db.select().from(pageBlocks).where(eq(pageBlocks.pageId, pageId)).orderBy(pageBlocks.idx);
    return {
      source: page.source,
      width: page.width,
      height: page.height,
      blocks: rows.map((r) => ({
        id: r.idx,
        kind: r.kind === "sfx" ? "sfx" : "text",
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        include: r.include,
        source_text: r.sourceText,
        translated_text: r.translatedText,
        ...(r.renderJson ? { render: JSON.parse(r.renderJson) as RenderInfo } : {}),
        ...(r.shapeJson ? { shape: JSON.parse(r.shapeJson) as BlockShape } : {}),
        ...(r.styleJson ? { style: JSON.parse(r.styleJson) as TextStyle } : {}),
        ...(r.areaJson ? { area: JSON.parse(r.areaJson) as StoredArea } : {}),
        ...(r.cleanJson ? { clean: JSON.parse(r.cleanJson) as PageBlock["clean"] } : {}),
        ...(r.needsTranslate ? { needs_translate: true } : {}),
        ...(r.needsRender ? { needs_render: true } : {}),
      })),
    };
  }

  /** Replaces the page's blocks and size in one transaction. */
  static writeJob(pageId: string, job: PageJob): void {
    db.transaction((tx) => {
      tx.update(pages)
        .set({ width: job.width, height: job.height, updatedAt: sql`(datetime('now'))` })
        .where(eq(pages.id, pageId))
        .run();
      tx.delete(pageBlocks).where(eq(pageBlocks.pageId, pageId)).run();
      if (job.blocks.length === 0) return;
      tx.insert(pageBlocks)
        .values(job.blocks.map((b) => ({
          pageId,
          idx: b.id,
          kind: b.kind,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          include: b.include,
          sourceText: b.source_text,
          translatedText: b.translated_text,
          renderJson: b.render ? JSON.stringify(b.render) : null,
          shapeJson: shapeToJson(b.shape),
          styleJson: b.style ? JSON.stringify(b.style) : null,
          areaJson: b.area ? JSON.stringify(b.area) : null,
          cleanJson: b.clean ? JSON.stringify(b.clean) : null,
          needsTranslate: b.needs_translate ?? false,
          needsRender: b.needs_render ?? false,
        })))
        .run();
    });
  }

  /**
   * Sets one block's source text, translation, include-in-cleaning flag and/or lettering style (null clears it), and
   * marks `staleStages` stale in the same transaction. False (and nothing marked) when the block doesn't exist.
   */
  static async updateBlock(
    pageId: string,
    idx: number,
    fields: { sourceText?: string; translatedText?: string; include?: boolean; style?: TextStyle | null },
    staleStages: readonly StageName[] = [],
  ): Promise<boolean> {
    // The block is out of date for exactly the stages this edit makes stale; a flag already set stays set
    const needsTranslate = staleStages.includes("translate") ? true : undefined;
    const needsRender = staleStages.includes("render") ? true : undefined;
    return db.transaction((tx) => {
      const rows = tx
        .update(pageBlocks)
        .set({
          sourceText: fields.sourceText,
          translatedText: fields.translatedText,
          include: fields.include,
          needsTranslate,
          needsRender,
          styleJson: fields.style === undefined ? undefined : fields.style === null ? null : JSON.stringify(fields.style),
          updatedAt: sql`(datetime('now'))`,
        })
        .where(and(eq(pageBlocks.pageId, pageId), eq(pageBlocks.idx, idx)))
        .returning({ idx: pageBlocks.idx })
        .all();
      if (rows.length === 0) return false;
      markStaleIn(tx, pageId, staleStages);
      return true;
    });
  }

  /**
   * Adds a block drawn in the Studio with the next free index and marks `staleStages` stale, all in one transaction.
   * Returns the new index. Call under the page lock.
   */
  static async insertBlock(
    pageId: string,
    kind: PageBlock["kind"],
    geometry: BlockGeometry,
    include = true,
    text: { sourceText?: string | null; translatedText?: string | null; style?: TextStyle | null } = {},
    staleStages: readonly StageName[] = [],
  ): Promise<number> {
    return db.transaction((tx) => {
      const row = tx
        .select({ max: sql<number>`coalesce(max(${pageBlocks.idx}), 0)` })
        .from(pageBlocks)
        .where(eq(pageBlocks.pageId, pageId))
        .get();
      const idx = (row?.max ?? 0) + 1;
      tx.insert(pageBlocks)
        .values({
          pageId,
          idx,
          kind,
          x: geometry.x,
          y: geometry.y,
          w: geometry.w,
          h: geometry.h,
          include,
          shapeJson: shapeToJson(geometry.shape),
          sourceText: text.sourceText ?? null,
          translatedText: text.translatedText ?? null,
          styleJson: text.style && Object.keys(text.style).length > 0 ? JSON.stringify(text.style) : null,
          // A new region changes the cleaning and the lettering; it needs translating if it came with text and no
          // translation of it
          needsRender: true,
          needsTranslate: kind === "text" && Boolean(text.sourceText?.trim()) && !text.translatedText?.trim(),
        })
        .run();
      markStaleIn(tx, pageId, staleStages);
      return idx;
    });
  }

  /**
   * Moves / resizes / reshapes a block (its previous render no longer applies) and marks `staleStages` stale in the
   * same transaction. False (and nothing marked) when the block doesn't exist.
   */
  static async updateBlockGeometry(pageId: string, idx: number, geometry: BlockGeometry, staleStages: readonly StageName[] = []): Promise<boolean> {
    return db.transaction((tx) => {
      const rows = tx
        .update(pageBlocks)
        .set({
          x: geometry.x,
          y: geometry.y,
          w: geometry.w,
          h: geometry.h,
          shapeJson: shapeToJson(geometry.shape),
          renderJson: null,
          areaJson: null,
          // Moved or reshaped: its lettering has to be placed and burned again
          needsRender: true,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(and(eq(pageBlocks.pageId, pageId), eq(pageBlocks.idx, idx)))
        .returning({ idx: pageBlocks.idx })
        .all();
      if (rows.length === 0) return false;
      markStaleIn(tx, pageId, staleStages);
      return true;
    });
  }

  /** Removes a block and marks `staleStages` stale in the same transaction. False (and nothing marked) when it doesn't exist. */
  static async deleteBlock(pageId: string, idx: number, staleStages: readonly StageName[] = []): Promise<boolean> {
    return db.transaction((tx) => {
      const rows = tx
        .delete(pageBlocks)
        .where(and(eq(pageBlocks.pageId, pageId), eq(pageBlocks.idx, idx)))
        .returning({ idx: pageBlocks.idx })
        .all();
      if (rows.length === 0) return false;
      markStaleIn(tx, pageId, staleStages);
      return true;
    });
  }

  /** Pipeline storage backed by this store, so every stage writes straight to SQLite. */
  static repository(pageId: string): JobRepository {
    return {
      read: () => PageStore.readJob(pageId),
      write: async (job) => PageStore.writeJob(pageId, job),
      resultChanged: () => PageStore.noteResultChanged(pageId),
    };
  }
}
