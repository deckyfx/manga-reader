import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/db/index";
import { pageBlocks, pages, pageStages, type NewPage, type Page, type PageStageRow } from "@/db/schema";
import type { BlockShape, JobRepository, PageBlock, PageJob } from "@/services/page-pipeline";

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
export const PAGE_JOBS_DIR = "./data/jobs";

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

  /** Existing page for this image, or a new queued one. Safe against concurrent inserts of the same image. */
  static async findOrCreate(imageHash: string, source: string): Promise<{ page: Page; created: boolean }> {
    const existing = await db.query.pages.findFirst({ where: eq(pages.imageHash, imageHash) });
    if (existing) return { page: existing, created: false };
    const [row] = await db
      .insert(pages)
      .values({ id: randomUUIDv7(), imageHash, source })
      .onConflictDoNothing({ target: pages.imageHash })
      .returning();
    if (row) return { page: row, created: true };
    const raced = await db.query.pages.findFirst({ where: eq(pages.imageHash, imageHash) });
    if (!raced) throw new Error("failed to create page");
    return { page: raced, created: false };
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
   * Removes folders of deleted pages whose cleanup failed (see DELETE /studio/api/pages/:id). Only direct entries
   * of the jobs directory named `<page id>.deleting-<timestamp>` are touched. Returns how many were removed.
   */
  static async sweepDeletedPageFolders(): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(PAGE_JOBS_DIR);
    } catch {
      return 0;
    }
    const parked = entries.filter((name) => PARKED_FOLDER.test(name));
    await Promise.all(parked.map((name) => rm(join(PAGE_JOBS_DIR, name), { recursive: true, force: true })));
    return parked.length;
  }

  /** Deletes a page row; its stages and blocks go with it (foreign keys cascade). False when it didn't exist. */
  static async deletePage(id: string): Promise<boolean> {
    const rows = await db.delete(pages).where(eq(pages.id, id)).returning({ id: pages.id });
    return rows.length > 0;
  }

  /** Increments the publish revision and returns the new value. */
  static async bumpRevision(id: string): Promise<number> {
    const [row] = await db
      .update(pages)
      .set({ revision: sql`${pages.revision} + 1`, updatedAt: sql`(datetime('now'))` })
      .where(eq(pages.id, id))
      .returning({ revision: pages.revision });
    if (!row) throw new Error("page not found");
    return row.revision;
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
        })))
        .run();
    });
  }

  /**
   * Sets one block's source text and/or translation and marks `staleStages` stale in the same transaction.
   * False (and nothing marked) when the block doesn't exist.
   */
  static async updateBlockText(
    pageId: string,
    idx: number,
    text: { sourceText?: string; translatedText?: string },
    staleStages: readonly StageName[] = [],
  ): Promise<boolean> {
    return db.transaction((tx) => {
      const rows = tx
        .update(pageBlocks)
        .set({ ...text, updatedAt: sql`(datetime('now'))` })
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
    text: { sourceText?: string | null; translatedText?: string | null } = {},
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
    };
  }
}
