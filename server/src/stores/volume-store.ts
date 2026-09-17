import { db } from "@/db/index";
import { volumes, chapters, type Volume, type NewVolume, type Chapter, type NewChapter } from "@/db/schema";
import { eq, asc, desc } from "drizzle-orm";

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

  static async delete(id: number): Promise<void> {
    await db.delete(volumes).where(eq(volumes.id, id));
  }

  // ── Chapters ───────────────────────────────────────────────────────────────

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

  static async deleteChapter(id: number): Promise<void> {
    await db.delete(chapters).where(eq(chapters.id, id));
  }
}
