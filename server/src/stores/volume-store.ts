import { db } from "@/db/index";
import { volumes, chapters, pages, type Volume, type NewVolume, type Chapter, type NewChapter } from "@/db/schema";
import { eq, asc, desc, inArray, sql } from "drizzle-orm";

export class VolumeStore {
  // ── Volumes ────────────────────────────────────────────────────────────────

  static async list(): Promise<Volume[]> {
    return db.select().from(volumes).orderBy(asc(volumes.title));
  }

  static async findById(id: number): Promise<Volume | undefined> {
    return db.query.volumes.findFirst({ where: eq(volumes.id, id) });
  }

  static async insert(data: NewVolume): Promise<Volume> {
    const [row] = await db.insert(volumes).values(data).returning();
    return row;
  }

  static async update(id: number, data: Partial<NewVolume>): Promise<Volume | undefined> {
    const [row] = await db
      .update(volumes)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(volumes.id, id))
      .returning();
    return row;
  }

  /** Deletes a volume with its chapters; their pages keep their images and return to the Inbox. */
  static async delete(id: number): Promise<void> {
    db.transaction((tx) => {
      const owned = tx.select({ id: chapters.id }).from(chapters).where(eq(chapters.volumeId, id)).all();
      if (owned.length > 0) {
        tx.update(pages)
          .set({ chapterId: null, sortOrder: 0, updatedAt: sql`(datetime('now'))` })
          .where(inArray(pages.chapterId, owned.map((c) => c.id)))
          .run();
        tx.delete(chapters).where(eq(chapters.volumeId, id)).run();
      }
      tx.delete(volumes).where(eq(volumes.id, id)).run();
    });
  }

  // ── Chapters ───────────────────────────────────────────────────────────────

  /** Volumes with how many chapters each holds. */
  static async listWithCounts(): Promise<{ volume: Volume; chapters: number }[]> {
    const list = await VolumeStore.list();
    if (list.length === 0) return [];
    const rows = await db
      .select({ volumeId: chapters.volumeId, count: sql<number>`count(*)` })
      .from(chapters)
      .where(inArray(chapters.volumeId, list.map((v) => v.id)))
      .groupBy(chapters.volumeId);
    const counts = new Map(rows.map((r) => [r.volumeId, Number(r.count)]));
    return list.map((volume) => ({ volume, chapters: counts.get(volume.id) ?? 0 }));
  }

  static async listChapters(volumeId: number): Promise<Chapter[]> {
    return db
      .select()
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(asc(chapters.sortOrder));
  }

  static async findChapterById(id: number): Promise<Chapter | undefined> {
    return db.query.chapters.findFirst({ where: eq(chapters.id, id) });
  }

  static async insertChapter(data: NewChapter): Promise<Chapter> {
    const [row] = await db.insert(chapters).values(data).returning();
    return row;
  }

  static async updateChapter(id: number, data: Partial<NewChapter>): Promise<Chapter | undefined> {
    const [row] = await db
      .update(chapters)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(chapters.id, id))
      .returning();
    return row;
  }

  /** Deletes a chapter; its pages keep their images and return to the Inbox. */
  static async deleteChapter(id: number): Promise<void> {
    db.transaction((tx) => {
      tx.update(pages)
        .set({ chapterId: null, sortOrder: 0, updatedAt: sql`(datetime('now'))` })
        .where(eq(pages.chapterId, id))
        .run();
      tx.delete(chapters).where(eq(chapters.id, id)).run();
    });
  }
}
