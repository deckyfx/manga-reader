import { db } from "../db";
import { series, type Series, type NewSeries } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Series Store - Repository pattern for series operations
 */
export class SeriesStore {
  /**
   * Create a new series
   */
  static async create(data: NewSeries): Promise<Series> {
    const result = await db.insert(series).values(data).returning();
    const newSeries = result[0];
    if (!newSeries) {
      throw new Error("Failed to create series");
    }
    return newSeries;
  }

  /**
   * Find series by ID
   */
  static async findById(id: number): Promise<Series | null> {
    const result = await db.select().from(series).where(eq(series.id, id));
    return result[0] || null;
  }

  /**
   * Find series by slug
   */
  static async findBySlug(slug: string): Promise<Series | null> {
    const result = await db.select().from(series).where(eq(series.slug, slug));
    return result[0] || null;
  }

  /**
   * Get all series
   */
  static async findAll(): Promise<Series[]> {
    return await db.select().from(series);
  }

  /**
   * Update series
   */
  static async update(
    id: number,
    data: Partial<NewSeries>
  ): Promise<Series | null> {
    const result = await db
      .update(series)
      .set(data)
      .where(eq(series.id, id))
      .returning();
    return result[0] || null;
  }

  /**
   * Delete series
   */
  static async delete(id: number): Promise<boolean> {
    const result = await db.delete(series).where(eq(series.id, id)).returning();
    return result.length > 0;
  }
}
