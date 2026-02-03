import { db } from "../db";
import { series, chapters, type Series, type NewSeries } from "../db/schema";
import { eq, sql, like, and, isNotNull, SQL } from "drizzle-orm";
import { generateSlug } from "../lib/slug-encoder";

/**
 * Series Store - Repository pattern for series operations
 */
export class SeriesStore {
  /**
   * Create a new series with auto-generated slug
   */
  static async create(data: NewSeries): Promise<Series> {
    // Insert without slug first to get auto-increment ID
    const result = await db.insert(series).values(data).returning();
    const newSeries = result[0];
    if (!newSeries) {
      throw new Error("Failed to create series");
    }

    // Generate slug based on ID and update
    const slug = generateSlug("s", newSeries.id);
    const updated = await db
      .update(series)
      .set({ slug })
      .where(eq(series.id, newSeries.id))
      .returning();

    return updated[0] || newSeries;
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
   * Search series with filters (server-side using Drizzle API)
   */
  static async search(filters: {
    searchName?: string;
    hasChapters?: boolean;
    mustHaveTags?: string[];
    mustNotHaveTags?: string[];
  }): Promise<Series[]> {
    const conditions: SQL[] = [];

    // Name filter using Drizzle's like()
    if (filters.searchName) {
      conditions.push(like(series.title, `%${filters.searchName}%`));
    }

    // Tag filters using comma-wrapping for exact word matching
    if (filters.mustHaveTags && filters.mustHaveTags.length > 0) {
      for (const tag of filters.mustHaveTags) {
        // Wraps column and search tag in commas to ensure exact word matching
        conditions.push(
          sql`',' || ${series.tags} || ',' LIKE ${"%," + tag + ",%"}`,
        );
      }
    }

    if (filters.mustNotHaveTags && filters.mustNotHaveTags.length > 0) {
      for (const tag of filters.mustNotHaveTags) {
        // Wraps column and search tag in commas to ensure exact word matching
        conditions.push(
          sql`',' || ${series.tags} || ',' NOT LIKE ${"%," + tag + ",%"}`,
        );
      }
    }

    // hasChapters filter using LEFT JOIN with groupBy
    if (filters.hasChapters) {
      conditions.push(isNotNull(chapters.id));

      const result = await db
        .select({ series })
        .from(series)
        .leftJoin(chapters, eq(chapters.seriesId, series.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(series.id);

      return result.map((r) => r.series);
    }

    // No hasChapters filter - simple select
    const result = await db
      .select()
      .from(series)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return result;
  }

  /**
   * Update series
   */
  static async update(
    id: number,
    data: Partial<NewSeries>,
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
