import { db } from "../db";
import { userCaptions } from "../db/schema";
import { eq } from "drizzle-orm";
import type { UserCaption, NewUserCaption } from "../db/schema";
import { generateSlug } from "../lib/slug-encoder";

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
   * Find caption by slug
   */
  static async findBySlug(slug: string): Promise<UserCaption | null> {
    const result = await db
      .select()
      .from(userCaptions)
      .where(eq(userCaptions.slug, slug))
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
    // Insert without slug first to get auto-increment ID
    const result = await db.insert(userCaptions).values(data).returning();

    const newCaption = result[0];
    if (!newCaption) {
      throw new Error("Failed to create caption");
    }

    // Generate slug based on ID and update
    const slug = generateSlug("u", newCaption.id);
    const updated = await db
      .update(userCaptions)
      .set({ slug })
      .where(eq(userCaptions.id, newCaption.id))
      .returning();

    return updated[0] || newCaption;
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
   * Update caption by slug
   */
  static async updateBySlug(
    slug: string,
    data: Partial<NewUserCaption>
  ): Promise<UserCaption | null> {
    const result = await db
      .update(userCaptions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userCaptions.slug, slug))
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
   * Delete caption by slug
   */
  static async deleteBySlug(slug: string): Promise<boolean> {
    const result = await db
      .delete(userCaptions)
      .where(eq(userCaptions.slug, slug))
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
