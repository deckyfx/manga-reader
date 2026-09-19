/**
 * Studio workspaces: folders of pages being worked on together (an imported chapter, a batch of uploads, or a chapter
 * sent to the Studio as drafts). A page sits in at most one; deleting a workspace leaves its pages loose.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { pages, pageStages, workspaces, type NewWorkspace, type Page, type Workspace } from "@/db/schema";

/** What a workspace card shows besides the workspace itself. */
export interface WorkspaceCounts {
  pages: number;
  /** Pages rendered, with nothing made stale since. */
  done: number;
  /** Pages not translated yet (imported, never run). */
  idle: number;
  /** Pages with at least one stale stage (edited since, or never run past some stage). */
  stale: number;
  /** Pages whose last run failed. */
  error: number;
  /** Pages queued or running in the pipeline right now. */
  running: number;
  /** First page in workspace order, for the card's thumbnail. */
  firstPageId: string | null;
}

const EMPTY_COUNTS: WorkspaceCounts = { pages: 0, done: 0, idle: 0, stale: 0, error: 0, running: 0, firstPageId: null };

export class WorkspaceStore {
  static async findById(id: number): Promise<Workspace | undefined> {
    return db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
  }

  /** Workspaces, most recently touched first; `sourceUrl` narrows to earlier imports of the same chapter. */
  static async list(filter: { sourceUrl?: string } = {}): Promise<Workspace[]> {
    return db
      .select()
      .from(workspaces)
      .where(filter.sourceUrl !== undefined ? eq(workspaces.sourceUrl, filter.sourceUrl) : undefined)
      .orderBy(desc(workspaces.updatedAt), desc(workspaces.id));
  }

  static async create(data: Pick<NewWorkspace, "name" | "createdBy" | "sourceUrl" | "sourceProvider" | "adult" | "chapterId">): Promise<Workspace> {
    const [row] = await db.insert(workspaces).values(data).returning();
    if (!row) throw new Error("failed to create workspace");
    return row;
  }

  /** Renames it or flips its adult flag. Undefined when it doesn't exist. */
  static async update(id: number, data: Partial<Pick<NewWorkspace, "name" | "adult" | "chapterId">>): Promise<Workspace | undefined> {
    const [row] = await db
      .update(workspaces)
      .set({ ...data, updatedAt: sql`(datetime('now'))` })
      .where(eq(workspaces.id, id))
      .returning();
    return row;
  }

  /** Marks it as just worked on, so it rises to the top of the list. */
  static async touch(id: number): Promise<void> {
    await db.update(workspaces).set({ updatedAt: sql`(datetime('now'))` }).where(eq(workspaces.id, id));
  }

  /** Deletes the workspace only; its pages fall back to loose (the foreign key sets them null). */
  static async delete(id: number): Promise<boolean> {
    const rows = await db.delete(workspaces).where(eq(workspaces.id, id)).returning({ id: workspaces.id });
    return rows.length > 0;
  }

  /** Its pages in workspace order; the id settles ties, as for chapters. */
  static async pages(id: number): Promise<Page[]> {
    return db.select().from(pages).where(eq(pages.workspaceId, id)).orderBy(asc(pages.sortOrder), asc(pages.createdAt), asc(pages.id));
  }

  /** Which of these positions already hold a page, so a retried upload batch skips them. */
  static async takenPositions(id: number, sortOrders: number[]): Promise<Set<number>> {
    if (sortOrders.length === 0) return new Set();
    const rows = await db
      .select({ sortOrder: pages.sortOrder })
      .from(pages)
      .where(and(eq(pages.workspaceId, id), inArray(pages.sortOrder, sortOrders)));
    return new Set(rows.map((row) => row.sortOrder));
  }

  static async pageCount(id: number): Promise<number> {
    const row = await db.select({ count: sql<number>`count(*)` }).from(pages).where(eq(pages.workspaceId, id)).get();
    return Number(row?.count ?? 0);
  }

  /** Page and progress counts for each of these workspaces (every id is present, empty ones with zeros). */
  static async countsFor(ids: number[]): Promise<Map<number, WorkspaceCounts>> {
    const counts = new Map<number, WorkspaceCounts>(ids.map((id) => [id, { ...EMPTY_COUNTS }]));
    if (ids.length === 0) return counts;
    const staleStage = sql<number>`exists (select 1 from ${pageStages} where ${pageStages.pageId} = ${pages.id} and ${pageStages.status} = 'stale')`;
    const rendered = sql<number>`exists (select 1 from ${pageStages} where ${pageStages.pageId} = ${pages.id} and ${pageStages.stage} = 'render' and ${pageStages.status} = 'fresh')`;
    const rows = await db
      .select({ workspaceId: pages.workspaceId, id: pages.id, status: pages.status, stale: staleStage, rendered })
      .from(pages)
      .where(inArray(pages.workspaceId, ids))
      .orderBy(asc(pages.sortOrder), asc(pages.createdAt), asc(pages.id));
    for (const row of rows) {
      const entry = row.workspaceId === null ? undefined : counts.get(row.workspaceId);
      if (!entry) continue;
      entry.pages++;
      entry.firstPageId ??= row.id;
      if (row.status === "queued" || row.status === "running") entry.running++;
      else if (row.status === "error") entry.error++;
      else if (Number(row.stale) === 1) entry.stale++;
      else if (Number(row.rendered) === 1) entry.done++;
      else entry.idle++;
    }
    return counts;
  }
}
