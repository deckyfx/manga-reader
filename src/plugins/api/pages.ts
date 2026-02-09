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
    "/download",
    async ({ body }) => {
      const { chapterId: chapterIdStr, url, referer, userAgent } = body;
      const chapterId = parseInt(chapterIdStr);

      // Content-Type to file extension mapping
      const contentTypeToExt: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
        "image/avif": "avif",
      };

      // Validate chapter exists
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

      // Build fetch headers (default User-Agent to avoid CDN rejections)
      const headers: Record<string, string> = {
        "User-Agent": userAgent || "Mozilla/5.0 (compatible; MangaReader/1.0)",
      };
      if (referer) headers["Referer"] = referer;

      // Fetch image from URL
      const [fetchError, response] = await catchError(
        fetch(url, {
          headers,
          redirect: "follow",
        }),
      );

      if (fetchError) {
        console.error("Download error:", fetchError);
        return {
          success: false,
          error: `Failed to download: ${fetchError.message}`,
        };
      }

      if (!response.ok) {
        return {
          success: false,
          error: `URL returned status ${response.status}`,
        };
      }

      // Validate Content-Type before downloading body
      const contentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();

      if (!contentType || !contentType.startsWith("image/")) {
        return {
          success: false,
          error: `URL did not return an image. Content-Type: ${contentType || "unknown"}`,
        };
      }

      // Determine file extension from Content-Type
      const ext = contentTypeToExt[contentType] || "jpg";

      // Read response body
      const [bodyError, buffer] = await catchError(response.arrayBuffer());

      if (bodyError) {
        console.error("Read response body error:", bodyError);
        return {
          success: false,
          error: `Failed to read response: ${bodyError.message}`,
        };
      }

      if (buffer.byteLength === 0) {
        return {
          success: false,
          error: "Downloaded file is empty",
        };
      }

      // Create chapter directory
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

      // Get current page count
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

      // Generate filename and write file
      const filename = generateUniqueFilename(ext, nextOrderNum);
      const filePath = join(chapterDir, filename);

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

      // Create page record
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

      // Reindex pages
      const [reindexError] = await catchError(reindexChapterPages(chapterId));

      if (reindexError) {
        console.error("Reindex pages error:", reindexError);
      }

      return {
        success: true,
        page: newPage,
      };
    },
    {
      body: t.Object({
        chapterId: t.String(),
        url: t.String(),
        referer: t.Optional(t.String()),
        userAgent: t.Optional(t.String()),
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
  .delete(
    "/delete",
    async ({ query }) => {
      const slug = query.page;

      if (!slug) {
        return {
          success: false,
          error: "Page slug is required",
        };
      }

    // Find page by slug first
    const [findError, page] = await catchError(
      PageStore.findBySlug(slug),
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
  },
  {
    query: t.Object({
      page: t.String(),
    }),
  });
