import { Elysia, t } from "elysia";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { pages } from "../db/schema";
import { envConfig } from "../env-config";
import { OcrResultManager } from "../services/OcrResultManager";
import { TranslationService } from "../services/TranslationService";
import { PageStore } from "../stores/page-store";
import { CaptionStore } from "../stores/caption-store";
import { SeriesStore } from "../stores/series-store";
import { ChapterStore } from "../stores/chapter-store";

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
    return { message: "Hello from Comic Reader API!" };
  })
  .get("/comics", () => {
    return {
      comics: [
        { id: 1, title: "Sample Comic 1", pages: 20 },
        { id: 2, title: "Sample Comic 2", pages: 30 },
      ],
    };
  })
  .get(
    "/pages/:id",
    async ({ params }) => {
      try {
        const pageId = parseInt(params.id);
        const page = await PageStore.findById(pageId);

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
    }
  )
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
          error: error instanceof Error ? error.message : "Failed to get captions",
          captions: [],
        };
      }
    },
    {
      query: t.Object({
        pageId: t.Number(),
      }),
    }
  )
  .post("/echo", ({ body }) => {
    return { echo: body };
  }, {
    body: t.Object({
      message: t.String(),
    }),
  })
  .post(
    "/ocr",
    async ({ body }) => {
      try {
        const { pageId, imagePath, x, y, width, height, capturedImage } = body;

        // Decode base64 image
        const base64Data = capturedImage.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        // Generate filename
        const timestamp = Date.now();
        const filename = `cropped_${timestamp}.png`;

        // Save directly to OCR input directory
        await mkdir(envConfig.OCR_INPUT_DIR, { recursive: true });

        const ocrInputPath = join(envConfig.OCR_INPUT_DIR, filename);
        await writeFile(ocrInputPath, buffer);

        console.log(`[OCR] Image queued for processing: ${filename}`);

        // Wait for OCR result (up to 5 seconds)
        const resultManager = OcrResultManager.getInstance();
        const translationService = TranslationService.getInstance();

        try {
          const rawText = await resultManager.waitForResult(filename, 5000);

          // Translate the extracted text
          const translatedText = await translationService.translate(rawText);

          // Save caption immediately to database
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
            rawText: caption.rawText,
            translatedText: caption.translatedText,
            filename,
          };
        } catch (timeoutError) {
          // Timeout - return queued status
          console.log(`[OCR] Timeout waiting for result: ${filename}`);

          return {
            success: true,
            message: "Image queued for OCR processing (result pending)",
            filename,
          };
        }
      } catch (error) {
        console.error("OCR Error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to queue image for OCR",
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
    }
  )
  .put(
    "/captions/:id",
    async ({ params: { id }, body }) => {
      try {
        const caption = await CaptionStore.update(parseInt(id), {
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
          error: error instanceof Error ? error.message : "Failed to update caption",
        };
      }
    },
    {
      body: t.Object({
        rawText: t.String(),
        translatedText: t.Optional(t.String()),
      }),
    }
  )
  .delete("/captions/:id", async ({ params: { id } }) => {
    try {
      const deleted = await CaptionStore.delete(parseInt(id));

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
        error: error instanceof Error ? error.message : "Failed to delete caption",
      };
    }
  })
  // Series endpoints
  .get("/series", async () => {
    try {
      const allSeries = await SeriesStore.findAll();
      return {
        success: true,
        series: allSeries,
      };
    } catch (error) {
      console.error("Get series error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get series",
        series: [],
      };
    }
  })
  .get("/series/:id", async ({ params }) => {
    try {
      const seriesId = parseInt(params.id);
      const seriesData = await SeriesStore.findById(seriesId);

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

        // Generate slug from title
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

        // Parse tags if provided
        const tagsJson = tags
          ? JSON.stringify(tags.split(",").map((tag: string) => tag.trim()))
          : null;

        // Create series first without cover art
        const newSeries = await SeriesStore.create({
          title,
          slug,
          synopsis: synopsis || null,
          coverArt: null,
          tags: tagsJson,
        });

        // Handle cover art upload after getting series ID
        if (coverArt) {
          const ext = coverArt.name.split(".").pop() || "jpg";
          const filename = `cover.${ext}`;

          // Use absolute path from project root
          const projectRoot = process.cwd();
          const seriesDir = join(projectRoot, "src", "public", "uploads", newSeries.id.toString());
          const coversDir = join(seriesDir, "covers");
          const coverPath = join(coversDir, filename);

          await mkdir(coversDir, { recursive: true });
          const buffer = await coverArt.arrayBuffer();
          await writeFile(coverPath, new Uint8Array(buffer));

          // Update series with cover art path (relative to public directory)
          const coverArtPath = `/uploads/${newSeries.id}/covers/${filename}`;
          const updated = await SeriesStore.update(newSeries.id, { coverArt: coverArtPath });

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
          error: error instanceof Error ? error.message : "Failed to create series",
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
    }
  )
  .get("/series/:id/chapters", async ({ params }) => {
    try {
      const seriesId = parseInt(params.id);
      const chapters = await ChapterStore.findBySeriesId(seriesId);

      return {
        success: true,
        chapters,
      };
    } catch (error) {
      console.error("Get chapters error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get chapters",
        chapters: [],
      };
    }
  })
  .get("/chapters/:id", async ({ params }) => {
    try {
      const chapterId = parseInt(params.id);
      const chapter = await ChapterStore.findById(chapterId);

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
  .get("/chapters/:id/pages", async ({ params }) => {
    try {
      const chapterId = parseInt(params.id);
      const pages = await PageStore.findByChapterId(chapterId);

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
    "/chapters/:id",
    async ({ params, body }) => {
      try {
        const chapterId = parseInt(params.id);
        const { title, slug } = body;

        const updatedChapter = await ChapterStore.update(chapterId, {
          title,
          slug,
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
          error: error instanceof Error ? error.message : "Failed to update chapter",
        };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        slug: t.String(),
      }),
    }
  )
  .post(
    "/chapters",
    async ({ body }) => {
      try {
        const { seriesId: seriesIdStr, title, slug, zipFile } = body;
        const seriesId = parseInt(seriesIdStr);

        console.log(`[Chapter Upload] Starting upload for series ${seriesId}, chapter ${slug}`);

        // Check if slug already exists for this series
        const existingChapters = await ChapterStore.findBySeriesId(seriesId);
        if (existingChapters.some((ch) => ch.slug === slug)) {
          return {
            success: false,
            error: `Chapter ${slug} already exists in this series`,
          };
        }

        // Create chapter first to get chapter ID
        const chapter = await ChapterStore.create({
          seriesId,
          title,
          slug,
        });

        console.log(`[Chapter Upload] Created chapter ${chapter.id}`);

        // Create chapter directory
        const projectRoot = process.cwd();
        const chapterDir = join(projectRoot, "src", "public", "uploads", seriesId.toString(), "chapters", chapter.id.toString());
        await mkdir(chapterDir, { recursive: true });

        // Extract ZIP file
        console.log(`[Chapter Upload] Extracting ZIP...`);
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
        imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        console.log(`[Chapter Upload] Found ${imageFiles.length} images`);

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

          const ext = extname(imageFile.name);
          const pageFilename = `page${i + 1}${ext}`;
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

        console.log(`[Chapter Upload] Created ${pages.length} pages`);

        return {
          success: true,
          chapter,
          pagesCount: pages.length,
        };
      } catch (error) {
        console.error("Upload chapter error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to upload chapter",
        };
      }
    },
    {
      body: t.Object({
        seriesId: t.String(), // FormData sends as string
        title: t.String(),
        slug: t.String(),
        zipFile: t.File(),
      }),
    }
  )
  .put(
    "/series/:id",
    async ({ params, body }) => {
      try {
        const seriesId = parseInt(params.id);
        const { title, synopsis, tags, coverArt } = body;

        // Generate new slug if title changed
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

        // Parse tags if provided
        const tagsJson = tags
          ? JSON.stringify(tags.split(",").map((tag: string) => tag.trim()))
          : null;

        // Handle cover art upload
        let coverArtPath: string | null | undefined = undefined;
        if (coverArt) {
          const ext = coverArt.name.split(".").pop() || "jpg";
          const filename = `cover.${ext}`;

          // Use absolute path from project root
          const projectRoot = process.cwd();
          const seriesDir = join(projectRoot, "src", "public", "uploads", seriesId.toString());
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
          slug,
          synopsis: synopsis || null,
          tags: tagsJson,
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
          error: error instanceof Error ? error.message : "Failed to update series",
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
    }
  )
  .delete("/series/:id", async ({ params }) => {
    try {
      const seriesId = parseInt(params.id);
      const deleted = await SeriesStore.delete(seriesId);

      if (!deleted) {
        return {
          success: false,
          error: "Series not found",
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      console.error("Delete series error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete series",
      };
    }
  })
  .delete("/chapters/:id", async ({ params }) => {
    try {
      const chapterId = parseInt(params.id);
      const deleted = await ChapterStore.delete(chapterId);

      if (!deleted) {
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      return {
        success: true,
      };
    } catch (error) {
      console.error("Delete chapter error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete chapter",
      };
    }
  })
  .delete("/pages/:id", async ({ params }) => {
    try {
      const pageId = parseInt(params.id);

      // Get page to find chapterId before deleting
      const page = await PageStore.findById(pageId);
      if (!page) {
        return {
          success: false,
          error: "Page not found",
        };
      }

      const chapterId = page.chapterId;
      const deleted = await PageStore.delete(pageId);

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
        const { chapterId, position, image } = body;

        // Save image file
        const projectRoot = process.cwd();
        const chapter = await ChapterStore.findById(chapterId);
        if (!chapter) {
          return {
            success: false,
            error: "Chapter not found",
          };
        }

        const chapterDir = join(
          projectRoot,
          "src",
          "public",
          "uploads",
          chapter.seriesId.toString(),
          "chapters",
          chapter.id.toString()
        );
        await mkdir(chapterDir, { recursive: true });

        // Get file extension
        const ext = image.name.split(".").pop() || "jpg";
        const timestamp = Date.now();
        const filename = `page_${timestamp}.${ext}`;
        const filePath = join(chapterDir, filename);

        // Write file
        const buffer = await image.arrayBuffer();
        await writeFile(filePath, new Uint8Array(buffer));

        // Create new page at the desired position
        const imagePath = `/uploads/${chapter.seriesId}/chapters/${chapter.id}/${filename}`;

        const newPage = await PageStore.create({
          chapterId,
          originalImage: imagePath,
          orderNum: position + 1,
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
          error: error instanceof Error ? error.message : "Failed to upload page",
        };
      }
    },
    {
      body: t.Object({
        chapterId: t.Number(),
        position: t.Number(),
        image: t.File({ type: "image" }),
      }),
    }
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
          error: error instanceof Error ? error.message : "Failed to reorder pages",
        };
      }
    },
    {
      body: t.Object({
        updates: t.Array(
          t.Object({
            id: t.Number(),
            orderNum: t.Number(),
          })
        ),
      }),
    }
  );
