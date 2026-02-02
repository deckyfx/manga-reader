import { db } from "../db";
import { userCaptions } from "../db/schema";
import { eq } from "drizzle-orm";
import type { UserCaption, NewUserCaption } from "../db/schema";

/**
 * CaptionStore - Repository for user caption database operations
 */
export class CaptionStore {
  /**
   * Find caption by ID
   */
  static async findById(id: number): Promise<UserCaption | null> {
    const result = await db
      .select()
      .from(userCaptions)
      .where(eq(userCaptions.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find all captions for a specific page
   */
  static async findByPageId(pageId: number): Promise<UserCaption[]> {
    return await db
      .select()
      .from(userCaptions)
      .where(eq(userCaptions.pageId, pageId));
  }

  /**
   * Create new caption
   */
  static async create(data: NewUserCaption): Promise<UserCaption> {
    const result = await db.insert(userCaptions).values(data).returning();

    const caption = result[0];
    if (!caption) {
      throw new Error("Failed to create caption");
    }

    return caption;
  }

  /**
   * Update caption by ID
   */
  static async update(
    id: number,
    data: Partial<NewUserCaption>
  ): Promise<UserCaption | null> {
    const result = await db
      .update(userCaptions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userCaptions.id, id))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Delete caption by ID
   */
  static async delete(id: number): Promise<boolean> {
    const result = await db
      .delete(userCaptions)
      .where(eq(userCaptions.id, id))
      .returning();

    return result.length > 0;
  }

  /**
   * Delete all captions for a page
   */
  static async deleteByPageId(pageId: number): Promise<number> {
    const result = await db
      .delete(userCaptions)
      .where(eq(userCaptions.pageId, pageId))
      .returning();

    return result.length;
  }
}
