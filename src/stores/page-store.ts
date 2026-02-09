import { db } from "../db";
import { pages } from "../db/schema";
import { eq } from "drizzle-orm";
import type { Page, NewPage } from "../db/schema";
import { generateSlug } from "../lib/slug-encoder";

/**
 * PageStore - Repository for manga page database operations
 */
export class PageStore {
  /**
   * Find page by ID
   */
  static async findById(id: number): Promise<Page | null> {
    const result = await db
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find page by slug
   */
  static async findBySlug(slug: string): Promise<Page | null> {
    const result = await db
      .select()
      .from(pages)
      .where(eq(pages.slug, slug))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find page by original image path
   */
  static async findByImage(imagePath: string): Promise<Page | null> {
    const result = await db
      .select()
      .from(pages)
      .where(eq(pages.originalImage, imagePath))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Get all pages
   */
  static async findAll(): Promise<Page[]> {
    return await db.select().from(pages);
  }

  /**
   * Create a new page
   */
  static async create(data: NewPage): Promise<Page> {
    // Insert without slug first to get auto-increment ID
    const result = await db.insert(pages).values(data).returning();
    const newPage = result[0];
    if (!newPage) {
      throw new Error("Failed to create page");
    }

    // Generate slug based on ID and update
    const slug = generateSlug("p", newPage.id);
    const updated = await db
      .update(pages)
      .set({ slug })
      .where(eq(pages.id, newPage.id))
      .returning();

    return updated[0] || newPage;
  }

  /**
   * Create new page or return existing one (legacy support)
   */
  static async findOrCreate(imagePath: string): Promise<Page> {
    // Check if page already exists
    const existing = await this.findByImage(imagePath);
    if (existing) {
      return existing;
    }

    // Create new page with default chapter (for backward compatibility)
    const result = await db
      .insert(pages)
      .values({
        chapterId: 1,
        originalImage: imagePath,
        orderNum: 1,
      })
      .returning();

    const page = result[0];
    if (!page) {
      throw new Error("Failed to create page");
    }

    return page;
  }

  /**
   * Find all pages for a chapter, ordered by page number
   */
  static async findByChapterId(chapterId: number): Promise<Page[]> {
    return await db
      .select()
      .from(pages)
      .where(eq(pages.chapterId, chapterId))
      .orderBy(pages.orderNum);
  }

  /**
   * Update page by ID
   */
  static async update(id: number, data: Partial<NewPage>): Promise<Page | null> {
    const result = await db
      .update(pages)
      .set(data)
      .where(eq(pages.id, id))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Delete page by ID (cascades to captions)
   */
  static async delete(id: number): Promise<boolean> {
    const result = await db.delete(pages).where(eq(pages.id, id)).returning();
    return result.length > 0;
  }
}
