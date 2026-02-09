import { Elysia, t } from "elysia";
import { join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { PageStore } from "../../stores/page-store";
import { ChapterStore } from "../../stores/chapter-store";
import { SeriesStore } from "../../stores/series-store";
import { CaptionStore } from "../../stores/caption-store";
import { PageDataStore } from "../../stores/page-data-store";
import { MangaOCRService } from "../../services/MangaOCRService";
import { CleaningService } from "../../services/CleaningService";
import { TranslationService } from "../../services/TranslationService";
import { BBPredictionService } from "../../services/BBPredictionService";
import { envConfig } from "../../env-config";
import { catchError, catchErrorSync } from "../../lib/error-handler";
import {
  getRegionBounds,
  getRegionPolygonPoints,
} from "../../lib/region-types";
import type { Region } from "../../lib/region-types";
import { unlink } from "node:fs/promises";

/**
 * Sort regions in manga reading order (right-to-left, top-to-bottom)
 */
function sortMangaReadingOrder(
  regions: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence: number;
    type: string;
  }>,
): typeof regions {
  const ROW_THRESHOLD = 20; // Pixels tolerance for same row detection

  // Group regions by row based on Y coordinate
  const rows: Array<{ y: number; regions: typeof regions }> = [];

  for (const region of regions) {
    const centerY = (region.y1 + region.y2) / 2;
    let foundRow = false;

    // Check if region belongs to existing row
    for (const row of rows) {
      if (Math.abs(row.y - centerY) <= ROW_THRESHOLD) {
        row.regions.push(region);
        foundRow = true;
        break;
      }
    }

    // Create new row if not found
    if (!foundRow) {
      rows.push({ y: centerY, regions: [region] });
    }
  }

  // Sort rows top-to-bottom (ascending Y)
  rows.sort((a, b) => a.y - b.y);

  // Within each row, sort right-to-left (descending X for manga)
  for (const row of rows) {
    row.regions.sort((a, b) => {
      const centerXA = (a.x1 + a.x2) / 2;
      const centerXB = (b.x1 + b.x2) / 2;
      return centerXB - centerXA; // Descending order (right to left)
    });
  }

  // Flatten back to single array
  return rows.flatMap((row) => row.regions);
}

// ─── TypeBox schemas matching Region discriminated union ───
const tPoint = t.Object({ x: t.Number(), y: t.Number() });

const tBoundingBox = t.Object({
  x: t.Number(),
  y: t.Number(),
  width: t.Number(),
  height: t.Number(),
});

const tRegion = t.Union([
  t.Object({ shape: t.Literal("rectangle"), data: tBoundingBox }),
  t.Object({
    shape: t.Literal("polygon"),
    data: t.Object({
      x: t.Number(),
      y: t.Number(),
      width: t.Number(),
      height: t.Number(),
      points: t.Array(tPoint),
    }),
  }),
  t.Object({ shape: t.Literal("oval"), data: tBoundingBox }),
]);

/**
 * Studio API plugin — Fabric.js-based studio endpoints.
 *
 * Current routes:
 * /api/studio/captions/:slug/translate POST  — translate caption text
 * /api/studio/ocr-batch               POST   — batch OCR + translation with optional cleaning
 * /api/studio/inpaint                 POST   — LaMa-based text cleaning
 * /api/studio/pages/:pageId/merge-textboxes POST — merge Fabric.js textboxes onto image
 * /api/studio/predict                 POST   — YOLO manga text detection
 */
export const studioApi = new Elysia({ prefix: "/studio" })
  // ─── Chapter endpoints ─────────────────────────────

  /**
   * Endpoint that resolve all data necesary for studio in one go by chapter slug
   * return {
   *   success: boolean,
   *   series: Series,
   *   chapter: Chapter,
   *   pages: Page[],
   *   pageData: PageData | null,
   * }
   **/
  .get(
    "/data/:chapterSlug",
    async ({ params: { chapterSlug }, query }) => {
      const { pageSlug } = query;
      // Load chapter
      const [chapterError, chapter] = await catchError(
        ChapterStore.findBySlug(chapterSlug),
      );

      if (chapterError || !chapter) {
        console.error("Get chapter error:", chapterError);
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      // Load series by chapter slug
      const [seriesError, series] = await catchError(
        SeriesStore.findByChapterSlug(chapterSlug),
      );

      if (seriesError || !series) {
        console.error("Get series error:", seriesError);
        return {
          success: false,
          error: "Series not found",
        };
      }

      // Load pages for this chapter
      const [pagesError, pages] = await catchError(
        PageStore.findByChapterId(chapter.id),
      );

      if (pagesError) {
        console.error("Get pages error:", pagesError);
        return {
          success: false,
          error: "Failed to load pages",
        };
      }

      // Load page data for current page (if pageSlug provided)
      let pageData = null;
      if (pageSlug) {
        const [pageDataError, foundPageData] = await catchError(
          PageDataStore.findByChapterAndPage(chapterSlug, pageSlug),
        );

        if (!pageDataError && foundPageData) {
          pageData = foundPageData;
        }
      }

      return {
        success: true,
        series,
        chapter,
        pages: pages || [],
        pageData,
      };
    },
    {
      query: t.Object({
        pageSlug: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Save page mask data
   * POST /studio/data
   * Body: { id?, pageId, maskData }
   */
  .post(
    "/data",
    async ({ body }) => {
      const { id, pageId, maskData } = body;

      // Get page info
      const [pageError, page] = await catchError(PageStore.findById(pageId));
      if (pageError || !page) {
        return {
          success: false,
          error: "Page not found",
        };
      }

      // Get chapter and series slugs
      const [chapterError, chapter] = await catchError(
        ChapterStore.findById(page.chapterId),
      );
      if (chapterError || !chapter) {
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      const [seriesError, series] = await catchError(
        SeriesStore.findById(chapter.seriesId),
      );
      if (seriesError || !series) {
        return {
          success: false,
          error: "Series not found",
        };
      }

      // Upsert page data
      const [saveError, savedPageData] = await catchError(
        PageDataStore.upsert({
          id,
          pageId,
          seriesSlug: series.slug!,
          chapterSlug: chapter.slug!,
          pageSlug: page.slug!,
          maskData,
        }),
      );

      if (saveError) {
        console.error("Save page data error:", saveError);
        return {
          success: false,
          error: saveError.message,
        };
      }

      return {
        success: true,
        pageData: savedPageData,
      };
    },
    {
      body: t.Object({
        id: t.Optional(t.Number()),
        pageId: t.Number(),
        maskData: t.String(),
      }),
    },
  )

  /**
   * Delete page mask data
   * DELETE /studio/data
   * Body: { id }
   */
  .delete(
    "/data",
    async ({ body }) => {
      const { id } = body;

      if (!id) {
        return {
          success: false,
          error: "Page data ID is required",
        };
      }

      // Delete page data
      const [deleteError, deleted] = await catchError(PageDataStore.delete(id));

      if (deleteError) {
        console.error("Delete page data error:", deleteError);
        return {
          success: false,
          error: deleteError.message,
        };
      }

      if (!deleted) {
        return {
          success: false,
          error: "Page data not found",
        };
      }

      return {
        success: true,
      };
    },
    {
      body: t.Object({
        id: t.Number(),
      }),
    },
  )

  // ─── Caption endpoints ─────────────────────────────
  .post("/captions/:slug/translate", async ({ params: { slug } }) => {
    const [captionError, caption] = await catchError(
      CaptionStore.findBySlug(slug),
    );

    if (captionError || !caption) {
      return {
        success: false,
        error: "Caption not found",
      };
    }

    const translationService = TranslationService.getInstance();
    const [translateError, translatedText] = await catchError(
      translationService.translate(caption.rawText),
    );

    if (translateError) {
      console.error("Retry translation error:", translateError);
      return {
        success: false,
        error: translateError.message,
      };
    }

    const [updateError, updatedCaption] = await catchError(
      CaptionStore.updateBySlug(slug, {
        translatedText: translatedText || null,
      }),
    );

    if (updateError || !updatedCaption) {
      console.error("Update caption error:", updateError);
      return {
        success: false,
        error: "Failed to update caption",
      };
    }

    return {
      success: true,
      caption: updatedCaption,
      translatedText: updatedCaption.translatedText,
    };
  }, {
    response: t.Union([
      t.Object({
        success: t.Literal(true),
        caption: t.Any(), // Caption type
        translatedText: t.Union([t.String(), t.Null()]),
      }),
      t.Object({
        success: t.Literal(false),
        error: t.String(),
      }),
    ]),
  })

  // ─── OCR Batch endpoint ────────────────────────────
  .post(
    "/ocr-batch",
    async ({ body }) => {
      const { pageId, regions, withCleaning, maskImageBase64 } = body;

      const ocrService = MangaOCRService.getInstance();
      const translationService = TranslationService.getInstance();

      const results: Array<
        | {
            id: string;
            success: true;
            captionId: number;
            captionSlug: string;
            rawText: string;
            translatedText: string | null;
            warning?: string;
          }
        | { id: string; success: false; error: string }
      > = [];

      // Process each region one-by-one
      for (const regionItem of regions) {
        const { id, capturedImage, region } = regionItem;

        const [error] = await catchError((async () => {
          // Convert base64 to buffer
          const base64Data = capturedImage.replace(
            /^data:image\/\w+;base64,/,
            "",
          );
          const buffer = Buffer.from(base64Data, "base64");

          let rawText = "";
          let translatedText: string | null = null;
          let warning: string | undefined;

          // Extract text via OCR
          const [ocrError, ocrResult] = await catchError(
            ocrService.extractText(buffer),
          );

          if (ocrError) {
            console.error(`OCR Error for region ${id}:`, ocrError);
            warning = `OCR failed: ${ocrError.message}`;
          } else {
            rawText = ocrResult;

            // Translate text
            const [translateError, translateResult] = await catchError(
              translationService.translate(rawText),
            );

            if (translateError) {
              console.error(
                `Translation Error for region ${id}:`,
                translateError,
              );
              warning = `Translation failed: ${translateError.message}`;
            } else {
              translatedText = translateResult || null;
            }
          }

          // Create caption in database
          const [captionError, caption] = await catchError(
            CaptionStore.create({
              pageId,
              region,
              capturedImage,
              rawText,
              translatedText,
            }),
          );

          if (captionError) {
            console.error(`Caption Error for region ${id}:`, captionError);
            results.push({
              id,
              success: false,
              error: captionError.message,
            });
          } else {
            results.push({
              id,
              success: true,
              captionId: caption.id,
              captionSlug: caption.slug || "",
              rawText: caption.rawText || "",
              translatedText: caption.translatedText,
              warning,
            });
          }
        })());

        if (error) {
          console.error(`Unexpected error for region ${id}:`, error);
          results.push({
            id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Perform cleaning if requested and mask provided
      if (!withCleaning || !maskImageBase64) {
        return {
          success: true,
          results,
          cleaned: false,
        };
      }
      const [pageError, page] = await catchError(PageStore.findById(pageId));

      if (pageError || !page) {
        return {
          success: false,
          error: "Page not found for cleaning",
          results,
        };
      }

      // Load page image
      const pageImagePath = join(
        envConfig.MANGA_DIR,
        page.originalImage.replace("/uploads/", ""),
      );

      const [imageError, imageFile] = await catchError(
        Bun.file(pageImagePath).arrayBuffer(),
      );

      if (imageError) {
        return {
          success: false,
          error: `Failed to load page image: ${imageError.message}`,
          results,
        };
      }

      // Convert image and mask to blobs
      const imageBuffer = Buffer.from(imageFile);
      const pageBlob = new Blob([imageBuffer], { type: "image/png" });

      const maskBlob = new Blob(
        [
          Buffer.from(
            maskImageBase64.replace(/^data:image\/\w+;base64,/, ""),
            "base64",
          ),
        ],
        { type: "image/png" },
      );

      // Perform inpainting with mask
      const [cleanError, cleanedImageBase64] = await catchError(
        CleaningService.inpaintWithMask(pageBlob, maskBlob),
      );

      if (cleanError) {
        return {
          success: false,
          error: `Cleaning failed: ${cleanError.message}`,
          results,
        };
      }

      // Save cleaned image
      const cleanedImageBuffer = Buffer.from(
        cleanedImageBase64.replace(/^data:image\/\w+;base64,/, ""),
        "base64",
      );

      const [writeError] = await catchError(
        Bun.write(pageImagePath, cleanedImageBuffer),
      );

      if (writeError) {
        return {
          success: false,
          error: "Failed to save cleaned image",
          results,
        };
      }

      // Clear page mask data
      const [, pageData] = await catchError(
        PageDataStore.findByPageId(pageId),
      );

      if (pageData) {
        await catchError(PageDataStore.delete(pageData.id));
      }

      return {
        success: true,
        results,
        cleaned: withCleaning && !!maskImageBase64,
      };
    },
    {
      body: t.Object({
        pageId: t.Number(),
        regions: t.Array(
          t.Object({
            id: t.String(),
            capturedImage: t.String(),
            region: tRegion,
          }),
        ),
        withCleaning: t.Optional(t.Boolean()),
        maskImageBase64: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          results: t.Array(
            t.Union([
              t.Object({
                id: t.String(),
                success: t.Literal(true),
                captionId: t.Number(),
                captionSlug: t.String(),
                rawText: t.String(),
                translatedText: t.Union([t.String(), t.Null()]),
                warning: t.Optional(t.String()),
              }),
              t.Object({
                id: t.String(),
                success: t.Literal(false),
                error: t.String(),
              }),
            ]),
          ),
          cleaned: t.Boolean(),
        }),
        400: t.Object({
          success: t.Literal(false),
          error: t.String(),
          results: t.Optional(t.Array(t.Any())),
        }),
      },
    },
  )

  // ─── Inpaint endpoint ──────────────────────────────
  .post(
    "/inpaint",
    async ({ body }) => {
      const { pageId, pageImageBase64, maskImageBase64 } = body;

      // Convert base64 to blobs
      const pageBlob = new Blob(
        [
          Buffer.from(
            pageImageBase64.replace(/^data:image\/\w+;base64,/, ""),
            "base64",
          ),
        ],
        { type: "image/png" },
      );
      const maskBlob = new Blob(
        [
          Buffer.from(
            maskImageBase64.replace(/^data:image\/\w+;base64,/, ""),
            "base64",
          ),
        ],
        { type: "image/png" },
      );

      // Call CleaningService for inpainting
      const [inpaintError, cleanedImageBase64] = await catchError(
        CleaningService.inpaintWithMask(pageBlob, maskBlob),
      );

      if (inpaintError) {
        console.error("Inpaint error:", inpaintError);
        return {
          success: false,
          error: inpaintError.message,
        };
      }

      // Get page from database
      const [pageError, page] = await catchError(PageStore.findById(pageId));
      if (pageError || !page) {
        return {
          success: false,
          error: "Page not found",
        };
      }

      // Save cleaned image to disk (replace original)
      const cleanedImageBuffer = Buffer.from(
        cleanedImageBase64.replace(/^data:image\/\w+;base64,/, ""),
        "base64",
      );

      // Strip /uploads/ prefix to get relative path
      const relativePath = page.originalImage.replace("/uploads/", "");
      const imagePath = join(envConfig.MANGA_DIR, relativePath);

      const [writeError] = await catchError(
        Bun.write(imagePath, cleanedImageBuffer),
      );

      if (writeError) {
        console.error("Failed to save cleaned image:", writeError);
        return {
          success: false,
          error: "Failed to save cleaned image",
        };
      }

      // Clear mask data from page data
      const [, pageData] = await catchError(
        PageDataStore.findByPageId(pageId),
      );

      if (pageData) {
        const [deleteError] = await catchError(
          PageDataStore.delete(pageData.id),
        );
        if (deleteError) {
          console.warn("Failed to delete page data:", deleteError);
        }
      }

      return {
        success: true,
        message: "Inpainting completed and image saved",
      };
    },
    {
      body: t.Object({
        pageId: t.Number(),
        pageImageBase64: t.String(),
        maskImageBase64: t.String(),
      }),
    },
  )

  // ─── Predict Regions (YOLO) endpoint ───────────────────
  .post(
    "/predict",
    async ({ body }) => {
      const { imageBase64 } = body;

      // Call BBPredictionService
      const [error, result] = await catchError(
        BBPredictionService.predictRegions(imageBase64),
      );

      if (error) {
        console.error("Predict regions error:", error);
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: true,
        regions: sortMangaReadingOrder(result.regions),
        imageSize: result.imageSize,
      };
    },
    {
      body: t.Object({
        imageBase64: t.String(),
      }),
    },
  )

  // ─── Save Client-Generated Patch ──────────────────────
  .post(
    "/patches/save",
    async ({ body }) => {
      const { captionSlug, patchImage, patchData } = body;

      // Find caption
      const [captionError, caption] = await catchError(
        CaptionStore.findBySlug(captionSlug),
      );

      if (captionError || !caption) {
        return {
          success: false,
          error: "Caption not found",
        };
      }

      // Get page to construct path
      const [pageError, page] = await catchError(
        PageStore.findById(caption.pageId),
      );

      if (pageError || !page) {
        return {
          success: false,
          error: "Page not found",
        };
      }

      const [chapterError, chapter] = await catchError(
        ChapterStore.findById(page.chapterId),
      );

      if (chapterError || !chapter) {
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      const [seriesError, series] = await catchError(
        SeriesStore.findById(chapter.seriesId),
      );

      if (seriesError || !series) {
        return {
          success: false,
          error: "Series not found",
        };
      }

      // Create patch directory if needed
      const patchDir = join(
        envConfig.MANGA_DIR,
        `series_${series.id}`,
        `chapter_${chapter.id}`,
        "patches",
      );

      const [mkdirError] = await catchError(
        mkdir(patchDir, { recursive: true }),
      );

      if (mkdirError) {
        console.error("Failed to create patch directory:", mkdirError);
        return {
          success: false,
          error: "Failed to create patch directory",
        };
      }

      // Save patch image
      const patchFilename = `${captionSlug}.png`;
      const patchPath = join(patchDir, patchFilename);

      // Decode base64 and write file
      const base64Data = patchImage.replace(/^data:image\/\w+;base64,/, "");
      const patchBuffer = Buffer.from(base64Data, "base64");

      const [writeError] = await catchError(Bun.write(patchPath, patchBuffer));

      if (writeError) {
        console.error("Failed to save patch image:", writeError);
        return {
          success: false,
          error: "Failed to save patch image",
        };
      }

      // Update caption with patch data
      const relativePatchPath = join(
        "uploads",
        `series_${series.id}`,
        `chapter_${chapter.id}`,
        "patches",
        patchFilename,
      );

      const [updateError] = await catchError(
        CaptionStore.update(caption.id, {
          patchImagePath: `/${relativePatchPath}`,
          clientPatchData: JSON.stringify(patchData),
          patchGeneratedBy: "client",
          patchGeneratedAt: new Date(),
        }),
      );

      if (updateError) {
        console.error("Failed to update caption:", updateError);
        return {
          success: false,
          error: "Failed to update caption",
        };
      }

      return {
        success: true,
        patchImagePath: `/${relativePatchPath}`,
      };
    },
    {
      body: t.Object({
        captionSlug: t.String(),
        patchImage: t.String(), // Base64 PNG
        patchData: t.Object({
          text: t.String(),
          leftRatio: t.Number(),
          topRatio: t.Number(),
          widthRatio: t.Number(),
          fontSizeRatio: t.Number(),
          fontFamily: t.String(),
          fontWeight: t.String(),
          fontStyle: t.String(),
          fill: t.String(),
          stroke: t.Optional(t.String()),
          strokeWidth: t.Optional(t.Number()),
        }),
      }),
    },
  )
  /**
   * Merge textboxes onto page image
   * POST /api/studio/pages/:pageId/merge-textboxes
   *
   * Replaces page's originalImage with merged version
   */
  .post(
    "/pages/:pageId/merge-textboxes",
    async ({ params, body }) => {
      const { pageId } = params;
      const { mergedImage } = body;

      // Find page
      const [pageError, page] = await catchError(
        PageStore.findById(Number(pageId)),
      );

      if (pageError || !page) {
        return {
          success: false,
          error: "Page not found",
        };
      }

      // Get chapter and series for path construction
      const [chapterError, chapter] = await catchError(
        ChapterStore.findById(page.chapterId),
      );

      if (chapterError || !chapter) {
        return {
          success: false,
          error: "Chapter not found",
        };
      }

      const [seriesError, series] = await catchError(
        SeriesStore.findById(chapter.seriesId),
      );

      if (seriesError || !series) {
        return {
          success: false,
          error: "Series not found",
        };
      }

      // Construct path for merged image
      const mergedDir = join(
        envConfig.MANGA_DIR,
        `series_${series.id}`,
        `chapter_${chapter.id}`,
        "pages",
      );

      // Create directory if needed
      const [mkdirError] = await catchError(
        mkdir(mergedDir, { recursive: true }),
      );

      if (mkdirError) {
        console.error("Failed to create merged directory:", mkdirError);
        return {
          success: false,
          error: "Failed to create directory",
        };
      }

      // Save merged image (replace original)
      const mergedFilename = `page_${String(page.orderNum).padStart(5, "0")}.png`;
      const mergedPath = join(mergedDir, mergedFilename);

      // Decode base64 and write file
      const base64Data = mergedImage.replace(/^data:image\/\w+;base64,/, "");
      const mergedBuffer = Buffer.from(base64Data, "base64");

      const [writeError] = await catchError(Bun.write(mergedPath, mergedBuffer));

      if (writeError) {
        console.error("Failed to save merged image:", writeError);
        return {
          success: false,
          error: "Failed to save merged image",
        };
      }

      // Update page record with new image path
      const relativeImagePath = join(
        "uploads",
        `series_${series.id}`,
        `chapter_${chapter.id}`,
        "pages",
        mergedFilename,
      );

      const [updateError] = await catchError(
        PageStore.update(page.id, {
          originalImage: `/${relativeImagePath}`,
        }),
      );

      if (updateError) {
        console.error("Failed to update page:", updateError);
        return {
          success: false,
          error: "Failed to update page",
        };
      }

      return {
        success: true,
        imagePath: `/${relativeImagePath}`,
      };
    },
    {
      params: t.Object({
        pageId: t.String(),
      }),
      body: t.Object({
        mergedImage: t.String(), // Base64 PNG
      }),
    },
  );
