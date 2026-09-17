import { db } from "@/db/index";
import {
  pageTranslationJobs,
  pageTranslationLogs,
  type PageTranslationJob,
  type NewPageTranslationJob,
  type PageTranslationLog,
  type NewPageTranslationLog,
} from "@/db/schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import { randomUUIDv7 } from "bun";

export class JobStore {
  // ── Jobs ───────────────────────────────────────────────────────────────────

  static async list(limit = 50): Promise<PageTranslationJob[]> {
    return db
      .select()
      .from(pageTranslationJobs)
      .orderBy(desc(pageTranslationJobs.createdAt))
      .limit(limit);
  }

  static async findById(id: string): Promise<PageTranslationJob | undefined> {
    return db.query.pageTranslationJobs.findFirst({
      where: eq(pageTranslationJobs.id, id),
    });
  }

  static async findByImageHash(imageHash: string): Promise<PageTranslationJob | undefined> {
    return db.query.pageTranslationJobs.findFirst({
      where: eq(pageTranslationJobs.imageHash, imageHash),
    });
  }

  static async insert(data: Omit<NewPageTranslationJob, "id"> & { id?: string }): Promise<PageTranslationJob> {
    const [row] = await db
      .insert(pageTranslationJobs)
      .values({ ...data, id: data.id ?? randomUUIDv7() })
      .returning();
    return row;
  }

  static async update(
    id: string,
    data: Partial<Omit<NewPageTranslationJob, "id">>
  ): Promise<PageTranslationJob | undefined> {
    const [row] = await db
      .update(pageTranslationJobs)
      .set({ ...data, updatedAt: sql`datetime('now')` })
      .where(eq(pageTranslationJobs.id, id))
      .returning();
    return row;
  }

  static async setStatus(
    id: string,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    await db
      .update(pageTranslationJobs)
      .set({
        status,
        updatedAt: sql`datetime('now')`,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      })
      .where(eq(pageTranslationJobs.id, id));
  }

  static async incrementProcessed(id: string): Promise<void> {
    await db
      .update(pageTranslationJobs)
      .set({
        processedBubbles: sql`${pageTranslationJobs.processedBubbles} + 1`,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(pageTranslationJobs.id, id));
  }

  static async delete(id: string): Promise<void> {
    await db.delete(pageTranslationJobs).where(eq(pageTranslationJobs.id, id));
  }

  // ── Bubble logs ────────────────────────────────────────────────────────────

  static async listBubbles(jobId: string): Promise<PageTranslationLog[]> {
    return db
      .select()
      .from(pageTranslationLogs)
      .where(eq(pageTranslationLogs.jobId, jobId))
      .orderBy(asc(pageTranslationLogs.bubbleIndex));
  }

  static async findBubble(jobId: string, bubbleIndex: number): Promise<PageTranslationLog | undefined> {
    return db.query.pageTranslationLogs.findFirst({
      where: (t, { and, eq }) => and(eq(t.jobId, jobId), eq(t.bubbleIndex, bubbleIndex)),
    });
  }

  static async insertBubble(data: Omit<NewPageTranslationLog, "id">): Promise<PageTranslationLog> {
    const [row] = await db.insert(pageTranslationLogs).values(data).returning();
    return row;
  }

  static async updateBubble(
    id: number,
    data: Partial<Omit<NewPageTranslationLog, "id">>
  ): Promise<PageTranslationLog | undefined> {
    const [row] = await db
      .update(pageTranslationLogs)
      .set({ ...data, updatedAt: sql`datetime('now')` })
      .where(eq(pageTranslationLogs.id, id))
      .returning();
    return row;
  }

  static async deleteBubble(id: number): Promise<void> {
    await db.delete(pageTranslationLogs).where(eq(pageTranslationLogs.id, id));
  }

  static async deleteAllBubbles(jobId: string): Promise<void> {
    await db.delete(pageTranslationLogs).where(eq(pageTranslationLogs.jobId, jobId));
  }
}
