import { Elysia, t } from "elysia";
import { mkdir, writeFile, unlink, rm } from "node:fs/promises";
import { join, extname } from "node:path";
import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { pages } from "../db/schema";
import { envConfig } from "../env-config";
import { MangaOCRService } from "../services/MangaOCRService";
import { TranslationService } from "../services/TranslationService";
import { PageStore } from "../stores/page-store";
import { CaptionStore } from "../stores/caption-store";
import { SeriesStore } from "../stores/series-store";
import { ChapterStore } from "../stores/chapter-store";

/**
 * Generate unique filename for uploaded page images
 * Format: page_{timestamp}_{random}_{orderNum}.{ext}
 *
 * @param extension - File extension (e.g., "jpg", "png")
 * @param orderNum - Optional page order number for readability
 * @returns Unique filename
 */
function generateUniqueFilename(extension: string, orderNum?: number): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8); // 6 random chars
  const orderStr = orderNum !== undefined ? `_${orderNum}` : "";
  return `page_${timestamp}_${random}${orderStr}.${extension}`;
}

/**
 * Helper function to reindex all pages in a chapter sequentially
 */
async function reindexChapterPages(chapterId: number) {
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

/**
 * API routes plugin with /api prefix
 */
export const apiPlugin = new Elysia({ prefix: "/api" })
  .get("/hello", () => {
    return { message: "Hello from Manga Reader API!" };
  })
  .get("/mangas", () => {
    return {
      mangas: [
        { id: 1, title: "Sample Manga 1", pages: 20 },
        { id: 2, title: "Sample Manga 2", pages: 30 },
      ],
    };
  })
  .get("/pages/:slug", async ({ params }) => {
    try {
      const page = await PageStore.findBySlug(params.slug);

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
    } catch (error) {
      console.error("Get page error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get page",
      };
    }
  })
  .get(
    "/captions",
    async ({ query }) => {
      try {
        const { pageId } = query;

        // Get all captions for this page
        const captions = await CaptionStore.findByPageId(pageId);

        return {
          success: true,
          captions,
        };
      } catch (error) {
        console.error("Get captions error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to get captions",
          captions: [],
        };
      }
    },
    {
      query: t.Object({
        pageId: t.Number(),
      }),
    },
  )
  .post(
    "/echo",
    ({ body }) => {
      return { echo: body };
    },
    {
      body: t.Object({
        message: t.String(),
      }),
    },
  )
  .post(
    "/ocr",
    async ({ body }) => {
      try {
        const { pageId, imagePath, x, y, width, height, capturedImage } = body;

        // Decode base64 image
        const base64Data = capturedImage.replace(
          /^data:image\/\w+;base64,/,
          "",
        );
        const buffer = Buffer.from(base64Data, "base64");

        // Get MangaOCRService instance
        const ocrService = MangaOCRService.getInstance();
        const translationService = TranslationService.getInstance();

        // Extract text using the new OCR service (direct socket communication)
        const rawText = await ocrService.extractText(buffer);

        // Translate the extracted text
        const translatedText = await translationService.translate(rawText);

        // Save caption to database
        const caption = await CaptionStore.create({
          pageId,
          x,
          y,
          width,
          height,
          capturedImage,
          rawText,
          translatedText: translatedText || null,
        });

        return {
          success: true,
          captionId: caption.id,
          captionSlug: caption.slug,
          rawText: caption.rawText,
          translatedText: caption.translatedText,
        };
      } catch (error) {
        console.error("OCR Error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to process OCR",
        };
      }
    },
    {
      body: t.Object({
        pageId: t.Number(),
        imagePath: t.String(),
        x: t.Number(),
        y: t.Number(),
        width: t.Number(),
        height: t.Number(),
        capturedImage: t.String(), // base64 data URL
      }),
    },
  )
  .put(
    "/captions/:slug",
    async ({ params: { slug }, body }) => {
      try {
        const caption = await CaptionStore.updateBySlug(slug, {
          rawText: body.rawText,
          translatedText: body.translatedText,
        });

        if (!caption) {
          return {
            success: false,
            error: "Caption not found",
          };
        }

        return {
          success: true,
          caption,
        };
      } catch (error) {
        console.error("Update caption error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update caption",
        };
      }
    },
    {
      body: t.Object({
        rawText: t.String(),
        translatedText: t.Optional(t.String()),
      }),
    },
  )
  .delete("/captions/:slug", async ({ params: { slug } }) => {
    try {
      const deleted = await CaptionStore.deleteBySlug(slug);

      if (!deleted) {
        return {
          success: false,
          error: "Caption not found",
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      console.error("Delete caption error:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete caption",
      };
    }
  })
  // Series endpoints
  .get(
    "/series",
    async ({ query }) => {
      try {
        // Parse filters from query parameters
        const filters: {
          searchName?: string;
          hasChapters?: boolean;
          mustHaveTags?: string[];
          mustNotHaveTags?: string[];
        } = {};

        // Parse searchName
        if (query.searchName) {
          filters.searchName = query.searchName;
        }

        // Parse hasChapters (handle both boolean and string)
        if (query.hasChapters === "true" || query.hasChapters === true) {
          filters.hasChapters = true;
        }

        // Parse mustHaveTags (comma-separated string to array)
        if (query.mustHaveTags) {
          filters.mustHaveTags = query.mustHaveTags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        }

        // Parse mustNotHaveTags (comma-separated string to array)
        if (query.mustNotHaveTags) {
          filters.mustNotHaveTags = query.mustNotHaveTags
            .split(",")
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        }

        // Use search method with filters
        const seriesData = await SeriesStore.search(filters);

        return {
          success: true,
          series: seriesData,
        };
      } catch (error) {
        console.error("Get series error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to get series",
          series: [],
        };
      }
    },
    {
      query: t.Object({
        searchName: t.Optional(t.String()),
        hasChapters: t.Optional(t.Union([t.Boolean(), t.String()])),
        mustHaveTags: t.Optional(t.String()), // Comma-separated
        mustNotHaveTags: t.Optional(t.String()), // Comma-separated
      }),
    },
  )
  .get("/series/:slug", async ({ params }) => {
    try {
      const seriesData = await SeriesStore.findBySlug(params.slug);

      if (!seriesData) {
        return {
          success: false,
          error: "Series not found",
        };
      }

      return {
        success: true,
        series: seriesData,
      };
    } catch (error) {
      console.error("Get series error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get series",
      };
    }
  })
  .post(
    "/series",
    async ({ body }) => {
      try {
        const { title, synopsis, tags, coverArt } = body;

        // Parse tags if provided (store as comma-separated string)
        const tagsCleaned = tags
          ? tags.split(",").map((tag: string) => tag.trim()).join(",")
          : null;

        // Create series (slug will be auto-generated by SeriesStore)
        const newSeries = await SeriesStore.create({
          title,
          synopsis: synopsis || null,
          coverArt: null,
          tags: tagsCleaned,
        });

        // Handle cover art upload after getting series ID
        if (coverArt) {
          const ext = coverArt.name.split(".").pop() || "jpg";
          const filename = `cover.${ext}`;

          // Use environment-aware manga directory
          const seriesDir = join(envConfig.MANGA_DIR, newSeries.id.toString());
          const coversDir = join(seriesDir, "covers");
          const coverPath = join(coversDir, filename);

          await mkdir(coversDir, { recursive: true });
          const buffer = await coverArt.arrayBuffer();
          await writeFile(coverPath, new Uint8Array(buffer));

          // Update series with cover art path (relative to public directory)
          const coverArtPath = `/uploads/${newSeries.id}/covers/${filename}`;
          const updated = await SeriesStore.update(newSeries.id, {
            coverArt: coverArtPath,
          });

          if (updated) {
            newSeries.coverArt = coverArtPath;
          }
        }

        return {
          success: true,
          series: newSeries,
        };
      } catch (error) {
        console.error("Create series error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to create series",
        };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        synopsis: t.Optional(t.String()),
        tags: t.Optional(t.String()),
        coverArt: t.Optional(t.File({ type: "image" })),
      }),
    },
  )
  .get("/series/:slug/chapters", async ({ params }) => {
    try {
      // Find series by slug first
      const series = await SeriesStore.findBySlug(params.slug);
      if (!series) {
        return {
          success: false,
          error: "Series not found",
          chapters: [],
        };
      }

      const chapters = await ChapterStore.findBySeriesId(series.id);

      return {
        success: true,
        chapters,
      };
    } catch (error) {
      console.error("Get chapters error:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get chapters",
        chapters: [],
      };
    }
  })
  .get("/chapters/:slug", async ({ params }) => {
    try {
      const chapter = await ChapterStore.findBySlug(params.slug);

      if (!chapter) {
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      return {
        success: true,
        chapter,
      };
    } catch (error) {
      console.error("Get chapter error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get chapter",
      };
    }
  })
  .get("/chapters/:slug/pages", async ({ params }) => {
    try {
      // Find chapter by slug first
      const chapter = await ChapterStore.findBySlug(params.slug);
      if (!chapter) {
        return {
          success: false,
          error: "Chapter not found",
          pages: [],
        };
      }

      const pages = await PageStore.findByChapterId(chapter.id);

      return {
        success: true,
        pages,
      };
    } catch (error) {
      console.error("Get chapter pages error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get pages",
        pages: [],
      };
    }
  })
  .put(
    "/chapters/:slug",
    async ({ params, body }) => {
      try {
        // Find chapter by slug first
        const chapter = await ChapterStore.findBySlug(params.slug);
        if (!chapter) {
          return {
            success: false,
            error: "Chapter not found",
          };
        }

        const { title, chapterNumber } = body;

        const updatedChapter = await ChapterStore.update(chapter.id, {
          title,
          chapterNumber,
        });

        if (!updatedChapter) {
          return {
            success: false,
            error: "Chapter not found",
          };
        }

        return {
          success: true,
          chapter: updatedChapter,
        };
      } catch (error) {
        console.error("Update chapter error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update chapter",
        };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        chapterNumber: t.String(),
      }),
    },
  )
  .post(
    "/chapters",
    async ({ body }) => {
      try {
        const { seriesId: seriesIdStr, title, chapterNumber, zipFile } = body;
        const seriesId = parseInt(seriesIdStr);

        // Check if chapter number already exists for this series
        const existingChapters = await ChapterStore.findBySeriesId(seriesId);
        if (existingChapters.some((ch) => ch.chapterNumber === chapterNumber)) {
          return {
            success: false,
            error: `Chapter ${chapterNumber} already exists in this series`,
          };
        }

        // Create chapter (slug will be auto-generated by ChapterStore)
        const chapter = await ChapterStore.create({
          seriesId,
          title,
          chapterNumber,
        });

        // Create chapter directory
        const chapterDir = join(
          envConfig.MANGA_DIR,
          seriesId.toString(),
          "chapters",
          chapter.id.toString(),
        );
        await mkdir(chapterDir, { recursive: true });

        // Extract ZIP file
        const zipBuffer = await zipFile.arrayBuffer();
        const extracted = unzipSync(new Uint8Array(zipBuffer));

        // Filter and sort image files
        const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
        const imageFiles: Array<{ name: string; data: Uint8Array }> = [];

        for (const [filename, data] of Object.entries(extracted)) {
          const ext = extname(filename).toLowerCase();
          if (imageExtensions.includes(ext)) {
            imageFiles.push({ name: filename, data: data as Uint8Array });
          }
        }

        // Sort images by filename (natural sort)
        imageFiles.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        );

        if (imageFiles.length === 0) {
          // Delete chapter if no images found
          await ChapterStore.delete(chapter.id);
          return {
            success: false,
            error: "No valid image files found in ZIP",
          };
        }

        // Save images and create page records
        const pages = [];
        for (let i = 0; i < imageFiles.length; i++) {
          const imageFile = imageFiles[i];
          if (!imageFile) continue;

          const ext = extname(imageFile.name).replace(".", ""); // Remove leading dot
          const pageFilename = generateUniqueFilename(ext, i + 1);
          const pagePath = join(chapterDir, pageFilename);

          // Write image file
          await writeFile(pagePath, imageFile.data);

          // Create page record
          const imagePath = `/uploads/${seriesId}/chapters/${chapter.id}/${pageFilename}`;
          const page = await PageStore.create({
            chapterId: chapter.id,
            originalImage: imagePath,
            orderNum: i + 1,
          });

          pages.push(page);
        }

        return {
          success: true,
          chapter,
          pagesCount: pages.length,
        };
      } catch (error) {
        console.error("Upload chapter error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to upload chapter",
        };
      }
    },
    {
      body: t.Object({
        seriesId: t.String(), // FormData sends as string
        title: t.String(),
        chapterNumber: t.String(),
        zipFile: t.File(),
      }),
    },
  )
  .put(
    "/series/:slug",
    async ({ params, body }) => {
      try {
        // Find series by slug first
        const series = await SeriesStore.findBySlug(params.slug);
        if (!series) {
          return {
            success: false,
            error: "Series not found",
          };
        }

        const seriesId = series.id;
        const { title, synopsis, tags, coverArt } = body;

        // Parse tags if provided (store as comma-separated string)
        const tagsCleaned = tags
          ? tags.split(",").map((tag: string) => tag.trim()).join(",")
          : null;

        // Handle cover art upload
        let coverArtPath: string | null | undefined = undefined;
        if (coverArt) {
          const ext = coverArt.name.split(".").pop() || "jpg";
          const filename = `cover.${ext}`;

          // Use environment-aware manga directory
          const seriesDir = join(envConfig.MANGA_DIR, seriesId.toString());
          const coversDir = join(seriesDir, "covers");
          const coverPath = join(coversDir, filename);

          await mkdir(coversDir, { recursive: true });
          const buffer = await coverArt.arrayBuffer();
          await writeFile(coverPath, new Uint8Array(buffer));

          // Store path relative to public directory
          coverArtPath = `/uploads/${seriesId}/covers/${filename}`;
        }

        const updateData: any = {
          title,
          synopsis: synopsis || null,
          tags: tagsCleaned,
        };

        // Only update coverArt if a new file was uploaded
        if (coverArtPath !== undefined) {
          updateData.coverArt = coverArtPath;
        }

        const updatedSeries = await SeriesStore.update(seriesId, updateData);

        if (!updatedSeries) {
          return {
            success: false,
            error: "Series not found",
          };
        }

        return {
          success: true,
          series: updatedSeries,
        };
      } catch (error) {
        console.error("Update series error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update series",
        };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        synopsis: t.Optional(t.String()),
        tags: t.Optional(t.String()),
        coverArt: t.Optional(t.File({ type: "image" })),
      }),
    },
  )
  .delete("/series/:slug", async ({ params }) => {
    try {
      // Find series by slug first
      const series = await SeriesStore.findBySlug(params.slug);
      if (!series) {
        return {
          success: false,
          error: "Series not found",
        };
      }

      // Delete entire series folder (includes all chapters, pages, and cover art)
      try {
        const seriesDir = join(envConfig.MANGA_DIR, series.id.toString());
        await rm(seriesDir, { recursive: true, force: true });
      } catch (dirError) {
        // Folder might not exist, log but don't fail the deletion
        console.warn(
          `⚠️  Could not delete series folder for series ${series.id}`,
          dirError,
        );
      }

      // Delete database record (cascades to chapters, pages, and captions)
      const deleted = await SeriesStore.delete(series.id);

      if (!deleted) {
        return {
          success: false,
          error: "Failed to delete series",
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      console.error("Delete series error:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete series",
      };
    }
  })
  .delete("/chapters/:slug", async ({ params }) => {
    try {
      // Find chapter by slug first
      const chapter = await ChapterStore.findBySlug(params.slug);
      if (!chapter) {
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      // Delete chapter folder and all its contents
      try {
        const chapterDir = join(
          envConfig.MANGA_DIR,
          chapter.seriesId.toString(),
          "chapters",
          chapter.id.toString(),
        );
        await rm(chapterDir, { recursive: true, force: true });
      } catch (dirError) {
        // Folder might not exist, log but don't fail the deletion
        console.warn(
          `⚠️  Could not delete chapter folder for chapter ${chapter.id}`,
          dirError,
        );
      }

      // Delete database record (cascades to pages and captions)
      const deleted = await ChapterStore.delete(chapter.id);

      if (!deleted) {
        return {
          success: false,
          error: "Failed to delete chapter",
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      console.error("Delete chapter error:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete chapter",
      };
    }
  })
  .delete("/pages/:slug", async ({ params }) => {
    try {
      // Find page by slug first
      const page = await PageStore.findBySlug(params.slug);
      if (!page) {
        return {
          success: false,
          error: "Page not found",
        };
      }

      const chapterId = page.chapterId;

      // Delete physical file from disk
      try {
        // Convert /uploads/seriesId/chapters/chapterId/filename to full path
        const relativePath = page.originalImage.replace("/uploads/", "");
        const filePath = join(envConfig.MANGA_DIR, relativePath);
        await unlink(filePath);
      } catch (fileError) {
        // File might not exist, log but don't fail the deletion
        console.warn(
          `⚠️  Could not delete file: ${page.originalImage}`,
          fileError,
        );
      }

      // Delete database record
      const deleted = await PageStore.delete(page.id);

      if (!deleted) {
        return {
          success: false,
          error: "Failed to delete page",
        };
      }

      // Reindex all pages in the chapter
      await reindexChapterPages(chapterId);

      return {
        success: true,
      };
    } catch (error) {
      console.error("Delete page error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete page",
      };
    }
  })
  .post(
    "/upload-page",
    async ({ body }) => {
      try {
        const { chapterId: chapterIdStr, image } = body;
        const chapterId = parseInt(chapterIdStr);

        // Save image file
        const chapter = await ChapterStore.findById(chapterId);
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
        await mkdir(chapterDir, { recursive: true });

        // Get current page count to add at the end
        const existingPages = await PageStore.findByChapterId(chapterId);
        const nextOrderNum = existingPages.length + 1;

        // Generate unique filename
        const ext = image.name.split(".").pop() || "jpg";
        const filename = generateUniqueFilename(ext, nextOrderNum);
        const filePath = join(chapterDir, filename);

        // Write file
        const buffer = await image.arrayBuffer();
        await writeFile(filePath, new Uint8Array(buffer));

        // Create new page at the end
        const imagePath = `/uploads/${chapter.seriesId}/chapters/${chapter.id}/${filename}`;

        const newPage = await PageStore.create({
          chapterId,
          originalImage: imagePath,
          orderNum: nextOrderNum,
        });

        // Reindex all pages in the chapter to ensure sequential order
        await reindexChapterPages(chapterId);

        return {
          success: true,
          page: newPage,
        };
      } catch (error) {
        console.error("Upload page error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to upload page",
        };
      }
    },
    {
      body: t.Object({
        chapterId: t.String(), // FormData sends as string
        image: t.File({ type: "image" }),
      }),
    },
  )
  .post(
    "/reorder-pages",
    async ({ body }) => {
      try {
        const { updates } = body;

        if (updates.length === 0) {
          return { success: true };
        }

        // Get chapterId from first page
        const firstPage = await PageStore.findById(updates[0]!.id);
        if (!firstPage) {
          return {
            success: false,
            error: "Page not found",
          };
        }

        // Batch update page order
        for (const update of updates) {
          await db
            .update(pages)
            .set({ orderNum: update.orderNum })
            .where(eq(pages.id, update.id));
        }

        // Reindex all pages to ensure sequential order
        await reindexChapterPages(firstPage.chapterId);

        return {
          success: true,
        };
      } catch (error) {
        console.error("Reorder pages error:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to reorder pages",
        };
      }
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
  );
