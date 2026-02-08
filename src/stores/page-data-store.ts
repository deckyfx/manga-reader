import { db } from "../db";
import { pageData } from "../db/schema";
import { eq, and } from "drizzle-orm";
import type { PageData, NewPageData } from "../db/schema";

/**
 * PageDataStore - Repository for page studio data operations
 */
export class PageDataStore {
  /**
   * Find page data by page ID
   */
  static async findByPageId(pageId: number): Promise<PageData | null> {
    const result = await db
      .select()
      .from(pageData)
      .where(eq(pageData.pageId, pageId))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find page data by page slug
   */
  static async findByPageSlug(pageSlug: string): Promise<PageData | null> {
    const result = await db
      .select()
      .from(pageData)
      .where(eq(pageData.pageSlug, pageSlug))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find page data by chapter slug and page slug
   */
  static async findByChapterAndPage(
    chapterSlug: string,
    pageSlug: string,
  ): Promise<PageData | null> {
    const result = await db
      .select()
      .from(pageData)
      .where(
        and(
          eq(pageData.chapterSlug, chapterSlug),
          eq(pageData.pageSlug, pageSlug),
        ),
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Create or update page data
   */
  static async upsert(data: NewPageData): Promise<PageData> {
    // Try to find existing
    const existing = await this.findByPageId(data.pageId);

    if (existing) {
      // Update existing
      const result = await db
        .update(pageData)
        .set({
          maskData: data.maskData,
          updatedAt: new Date(),
        })
        .where(eq(pageData.id, existing.id))
        .returning();

      const updated = result[0];
      if (!updated) {
        throw new Error("Failed to update page data");
      }
      return updated;
    } else {
      // Create new
      const result = await db.insert(pageData).values(data).returning();

      const newPageData = result[0];
      if (!newPageData) {
        throw new Error("Failed to create page data");
      }
      return newPageData;
    }
  }

  /**
   * Delete page data by ID
   */
  static async delete(id: number): Promise<boolean> {
    const result = await db
      .delete(pageData)
      .where(eq(pageData.id, id))
      .returning();
    return result.length > 0;
  }
}
