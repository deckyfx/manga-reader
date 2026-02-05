import { eq } from "drizzle-orm";
import { db } from "../../db";
import { pages } from "../../db/schema";
import { PageStore } from "../../stores/page-store";

/**
 * Generate unique filename for uploaded page images
 * Format: page_{timestamp}_{random}_{orderNum}.{ext}
 *
 * @param extension - File extension (e.g., "jpg", "png")
 * @param orderNum - Optional page order number for readability
 * @returns Unique filename
 */
export function generateUniqueFilename(
  extension: string,
  orderNum?: number,
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8); // 6 random chars
  const orderStr = orderNum !== undefined ? `_${orderNum}` : "";
  return `page_${timestamp}_${random}${orderStr}.${extension}`;
}

/**
 * Helper function to reindex all pages in a chapter sequentially
 */
export async function reindexChapterPages(chapterId: number): Promise<void> {
  const allPages = await PageStore.findByChapterId(chapterId);

  // Sort by current order_num
  allPages.sort((a, b) => a.orderNum - b.orderNum);

  // Update each page with sequential order_num
  for (let i = 0; i < allPages.length; i++) {
    const page = allPages[i];
    if (page && page.orderNum !== i + 1) {
      await db
        .update(pages)
        .set({ orderNum: i + 1 })
        .where(eq(pages.id, page.id));
    }
  }
}
