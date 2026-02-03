import { db } from "../db";
import { chapters, type Chapter, type NewChapter } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateSlug } from "../lib/slug-encoder";

/**
 * Chapter Store - Repository pattern for chapter operations
 */
export class ChapterStore {
  /**
   * Create a new chapter with auto-generated slug
   */
  static async create(data: NewChapter): Promise<Chapter> {
    // Insert without slug first to get auto-increment ID
    const result = await db.insert(chapters).values(data).returning();
    const newChapter = result[0];
    if (!newChapter) {
      throw new Error("Failed to create chapter");
    }

    // Generate slug based on ID and update
    const slug = generateSlug("c", newChapter.id);
    const updated = await db
      .update(chapters)
      .set({ slug })
      .where(eq(chapters.id, newChapter.id))
      .returning();

    return updated[0] || newChapter;
  }

  /**
   * Find chapter by ID
   */
  static async findById(id: number): Promise<Chapter | null> {
    const result = await db.select().from(chapters).where(eq(chapters.id, id));
    return result[0] || null;
  }

  /**
   * Find chapter by slug
   */
  static async findBySlug(slug: string): Promise<Chapter | null> {
    const result = await db.select().from(chapters).where(eq(chapters.slug, slug));
    return result[0] || null;
  }

  /**
   * Find all chapters for a series
   */
  static async findBySeriesId(seriesId: number): Promise<Chapter[]> {
    return await db
      .select()
      .from(chapters)
      .where(eq(chapters.seriesId, seriesId));
  }

  /**
   * Update chapter
   */
  static async update(
    id: number,
    data: Partial<NewChapter>
  ): Promise<Chapter | null> {
    const result = await db
      .update(chapters)
      .set(data)
      .where(eq(chapters.id, id))
      .returning();
    return result[0] || null;
  }

  /**
   * Delete chapter
   */
  static async delete(id: number): Promise<boolean> {
    const result = await db.delete(chapters).where(eq(chapters.id, id)).returning();
    return result.length > 0;
  }
}
