import { Elysia, t } from "elysia";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { pages } from "../../db/schema";
import { PageStore } from "../../stores/page-store";
import { ChapterStore } from "../../stores/chapter-store";
import { envConfig } from "../../env-config";
import { catchError } from "../../lib/error-handler";
import { generateUniqueFilename, reindexChapterPages } from "./helpers";

/**
 * Pages API endpoints
 */
export const pagesApi = new Elysia({ prefix: "/pages" })
  .get("/:slug", async ({ params }) => {
    const [error, page] = await catchError(PageStore.findBySlug(params.slug));

    if (error) {
      console.error("Get page error:", error);
      return {
        success: false,
        error: error.message,
      };
    }

    if (!page) {
      return {
        success: false,
        error: "Page not found",
      };
    }

    return {
      success: true,
      page,
    };
  })
  .post(
    "/upload",
    async ({ body }) => {
      const { chapterId: chapterIdStr, image } = body;
      const chapterId = parseInt(chapterIdStr);

      // Save image file
      const [chapterError, chapter] = await catchError(
        ChapterStore.findById(chapterId),
      );

      if (chapterError) {
        console.error("Find chapter error:", chapterError);
        return {
          success: false,
          error: chapterError.message,
        };
      }

      if (!chapter) {
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      const chapterDir = join(
        envConfig.MANGA_DIR,
        chapter.seriesId.toString(),
        "chapters",
        chapter.id.toString(),
      );

      const [mkdirError] = await catchError(
        mkdir(chapterDir, { recursive: true }),
      );

      if (mkdirError) {
        console.error("Create directory error:", mkdirError);
        return {
          success: false,
          error: mkdirError.message,
        };
      }

      // Get current page count to add at the end
      const [pagesError, existingPages] = await catchError(
        PageStore.findByChapterId(chapterId),
      );

      if (pagesError) {
        console.error("Find pages error:", pagesError);
        return {
          success: false,
          error: pagesError.message,
        };
      }

      const nextOrderNum = existingPages.length + 1;

      // Generate unique filename
      const ext = image.name.split(".").pop() || "jpg";
      const filename = generateUniqueFilename(ext, nextOrderNum);
      const filePath = join(chapterDir, filename);

      // Write file
      const [bufferError, buffer] = await catchError(image.arrayBuffer());

      if (bufferError) {
        console.error("Read image error:", bufferError);
        return {
          success: false,
          error: bufferError.message,
        };
      }

      const [writeError] = await catchError(
        writeFile(filePath, new Uint8Array(buffer)),
      );

      if (writeError) {
        console.error("Write file error:", writeError);
        return {
          success: false,
          error: writeError.message,
        };
      }

      // Create new page at the end
      const imagePath = `/uploads/${chapter.seriesId}/chapters/${chapter.id}/${filename}`;

      const [createError, newPage] = await catchError(
        PageStore.create({
          chapterId,
          originalImage: imagePath,
          orderNum: nextOrderNum,
        }),
      );

      if (createError) {
        console.error("Create page error:", createError);
        return {
          success: false,
          error: createError.message,
        };
      }

      // Reindex all pages in the chapter to ensure sequential order
      const [reindexError] = await catchError(reindexChapterPages(chapterId));

      if (reindexError) {
        console.error("Reindex pages error:", reindexError);
        // Don't fail if reindex fails
      }

      return {
        success: true,
        page: newPage,
      };
    },
    {
      body: t.Object({
        chapterId: t.String(), // FormData sends as string
        image: t.File({ type: "image" }),
      }),
    },
  )
  .post(
    "/reorder",
    async ({ body }) => {
      const { updates } = body;

      if (updates.length === 0) {
        return { success: true };
      }

      // Get chapterId from first page
      const [pageError, firstPage] = await catchError(
        PageStore.findById(updates[0]!.id),
      );

      if (pageError) {
        console.error("Find page error:", pageError);
        return {
          success: false,
          error: pageError.message,
        };
      }

      if (!firstPage) {
        return {
          success: false,
          error: "Page not found",
        };
      }

      // Batch update page order
      for (const update of updates) {
        const [updateError] = await catchError(
          (async () => {
            await db
              .update(pages)
              .set({ orderNum: update.orderNum })
              .where(eq(pages.id, update.id));
          })(),
        );

        if (updateError) {
          console.error("Update page error:", updateError);
          return {
            success: false,
            error: updateError.message,
          };
        }
      }

      // Reindex all pages to ensure sequential order
      const [reindexError] = await catchError(
        reindexChapterPages(firstPage.chapterId),
      );

      if (reindexError) {
        console.error("Reindex pages error:", reindexError);
        return {
          success: false,
          error: reindexError.message,
        };
      }

      return {
        success: true,
      };
    },
    {
      body: t.Object({
        updates: t.Array(
          t.Object({
            id: t.Number(),
            orderNum: t.Number(),
          }),
        ),
      }),
    },
  )
  .delete("/:slug", async ({ params }) => {
    // Find page by slug first
    const [findError, page] = await catchError(
      PageStore.findBySlug(params.slug),
    );

    if (findError) {
      console.error("Find page error:", findError);
      return {
        success: false,
        error: findError.message,
      };
    }

    if (!page) {
      return {
        success: false,
        error: "Page not found",
      };
    }

    const chapterId = page.chapterId;

    // Delete physical file from disk
    const relativePath = page.originalImage.replace("/uploads/", "");
    const filePath = join(envConfig.MANGA_DIR, relativePath);
    const [fileError] = await catchError(unlink(filePath));

    if (fileError) {
      // File might not exist, log but don't fail the deletion
      console.warn(
        `⚠️  Could not delete file: ${page.originalImage}`,
        fileError,
      );
    }

    // Delete database record
    const [deleteError, deleted] = await catchError(PageStore.delete(page.id));

    if (deleteError) {
      console.error("Delete page error:", deleteError);
      return {
        success: false,
        error: deleteError.message,
      };
    }

    if (!deleted) {
      return {
        success: false,
        error: "Failed to delete page",
      };
    }

    // Reindex all pages in the chapter
    const [reindexError] = await catchError(reindexChapterPages(chapterId));

    if (reindexError) {
      console.error("Reindex pages error:", reindexError);
      // Don't fail the delete if reindex fails
    }

    return {
      success: true,
    };
  });
