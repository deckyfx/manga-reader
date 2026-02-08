import { Elysia, t } from "elysia";
import { join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { PageStore } from "../../stores/page-store";
import { ChapterStore } from "../../stores/chapter-store";
import { SeriesStore } from "../../stores/series-store";
import { CaptionStore } from "../../stores/caption-store";
import { PageDataStore } from "../../stores/page-data-store";
import { PatchGeneratorService } from "../../services/PatchGeneratorService";
import { MangaOCRService } from "../../services/MangaOCRService";
import { MangaOCRAPI } from "../../services/MangaOCRAPI";
import { TranslationService } from "../../services/TranslationService";
import { envConfig } from "../../env-config";
import { catchError } from "../../lib/error-handler";
import {
  getRegionBounds,
  getRegionPolygonPoints,
} from "../../lib/region-types";
import type { Region } from "../../lib/region-types";

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
 * Helper function to generate and save patch image with manual parameters
 */
async function generateAndSavePatch(
  captionSlug: string,
  lines: string[],
  fontSize: number,
  fontType: "regular" | "bold" | "italic",
  textColor: string,
  strokeColor: string | null,
  strokeWidth: number,
  cleanerThreshold: number = 200,
  alphaBackground: boolean = false,
): Promise<string> {
  const caption = await CaptionStore.findBySlug(captionSlug);
  if (!caption) {
    throw new Error("Caption not found");
  }

  const page = await PageStore.findById(caption.pageId);
  if (!page) {
    throw new Error("Page not found");
  }

  const chapter = await ChapterStore.findById(page.chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }

  // Derive polygon points from region (if applicable)
  const bounds = getRegionBounds(caption.region);
  const polygonPoints = getRegionPolygonPoints(caption.region);

  let relativePolygonPoints: Array<{ x: number; y: number }> | undefined;
  if (polygonPoints) {
    relativePolygonPoints = polygonPoints.map((point) => ({
      x: point.x - bounds.x,
      y: point.y - bounds.y,
    }));
  }

  // Generate patch using PatchGeneratorService with manual parameters
  const patchService = PatchGeneratorService.getInstance();
  const base64Data = caption.capturedImage.replace(
    /^data:image\/\w+;base64,/,
    "",
  );

  const patchImageBase64 = await patchService.generatePatch(
    base64Data,
    lines,
    fontSize,
    fontType,
    textColor,
    strokeColor,
    strokeWidth,
    relativePolygonPoints,
    cleanerThreshold,
    alphaBackground,
  );

  // Create patches directory if it doesn't exist
  const patchesDir = join(
    envConfig.MANGA_DIR,
    chapter.seriesId.toString(),
    "chapters",
    chapter.id.toString(),
    "patches",
  );

  await mkdir(patchesDir, { recursive: true });

  // Save patch image
  const patchFilename = `${caption.slug}.png`;
  const patchPath = join(patchesDir, patchFilename);
  const patchBuffer = Buffer.from(patchImageBase64, "base64");
  await Bun.write(patchPath, patchBuffer);

  // Update database with patch path (relative path for serving)
  const relativePatchPath = `/uploads/${chapter.seriesId}/chapters/${chapter.id}/patches/${patchFilename}`;
  await CaptionStore.updatePatchPath(caption.slug!, relativePatchPath);

  return relativePatchPath;
}

/**
 * Studio API plugin — all caption, OCR, patch, and merge endpoints.
 *
 * Route structure:
 * /api/studio/captions?pageId=        GET    — list captions for a page
 * /api/studio/captions/:slug          PUT    — update caption text
 * /api/studio/captions/:slug          DELETE — delete caption
 * /api/studio/captions/:slug/region   PATCH  — update region after move/resize
 * /api/studio/captions/:slug/translate POST  — retry translation
 * /api/studio/captions/:slug/patch    POST   — generate patch
 * /api/studio/captions/:slug/patch    DELETE — delete patch
 * /api/studio/ocr                     POST   — create caption via OCR
 * /api/studio/merge                   PATCH  — merge patches onto page
 * /api/studio/extract                 POST   — re-extract OCR
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
      const [deleteError, deleted] = await catchError(
        PageDataStore.delete(id),
      );

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
  .get(
    "/captions",
    async ({ query }) => {
      const { pageId } = query;

      const [error, captions] = await catchError(
        CaptionStore.findByPageId(pageId),
      );

      if (error) {
        console.error("Get captions error:", error);
        return {
          success: false,
          error: error.message,
          captions: [],
        };
      }

      return {
        success: true,
        captions,
      };
    },
    {
      query: t.Object({
        pageId: t.Number(),
      }),
    },
  )
  .put(
    "/captions/:slug",
    async ({ params: { slug }, body }) => {
      const [error, caption] = await catchError(
        CaptionStore.updateBySlug(slug, {
          rawText: body.rawText,
          translatedText: body.translatedText,
        }),
      );

      if (error) {
        console.error("Update caption error:", error);
        return {
          success: false,
          error: error.message,
        };
      }

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
    },
    {
      body: t.Object({
        rawText: t.String(),
        translatedText: t.Optional(t.String()),
      }),
    },
  )
  .delete("/captions/:slug", async ({ params: { slug } }) => {
    const [error, deleted] = await catchError(CaptionStore.deleteBySlug(slug));

    if (error) {
      console.error("Delete caption error:", error);
      return {
        success: false,
        error: error.message,
      };
    }

    if (!deleted) {
      return {
        success: false,
        error: "Caption not found",
      };
    }

    return {
      success: true,
    };
  })
  .patch(
    "/captions/:slug/region",
    async ({ params: { slug }, body }) => {
      const { region, capturedImage } = body;

      const [error, caption] = await catchError(
        CaptionStore.updateBySlug(slug, {
          region: region as Region,
          capturedImage,
          patchImagePath: null,
          patchGeneratedAt: null,
        }),
      );

      if (error) {
        console.error("Update region error:", error);
        return {
          success: false,
          error: error.message,
        };
      }

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
    },
    {
      body: t.Object({
        region: tRegion,
        capturedImage: t.String(),
      }),
    },
  )
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
    };
  })
  .post(
    "/captions/:slug/patch",
    async ({ params: { slug }, body }) => {
      const patchService = PatchGeneratorService.getInstance();
      const [availError, isAvailable] = await catchError(
        patchService.isAvailable(),
      );

      if (availError || !isAvailable) {
        return {
          success: false,
          error: "Patch generator service is not available",
        };
      }

      const [error, patchUrl] = await catchError(
        generateAndSavePatch(
          slug,
          body.lines,
          body.fontSize,
          body.fontType,
          body.textColor,
          body.strokeColor,
          body.strokeWidth,
          body.cleanerThreshold ?? 200,
          body.alphaBackground ?? false,
        ),
      );

      if (error) {
        console.error("Generate patch error:", error);
        return {
          success: false,
          error: error.message,
        };
      }

      const [captionError, caption] = await catchError(
        CaptionStore.findBySlug(slug),
      );

      if (captionError || !caption) {
        return {
          success: false,
          error: "Failed to retrieve updated caption",
        };
      }

      return {
        success: true,
        patchUrl,
        patchGeneratedAt: caption.patchGeneratedAt?.toISOString(),
      };
    },
    {
      body: t.Object({
        lines: t.Array(t.String()),
        fontSize: t.Number(),
        fontType: t.Union([
          t.Literal("regular"),
          t.Literal("bold"),
          t.Literal("italic"),
        ]),
        textColor: t.String(),
        strokeColor: t.Nullable(t.String()),
        strokeWidth: t.Number(),
        cleanerThreshold: t.Optional(t.Number()),
        alphaBackground: t.Optional(t.Boolean()),
      }),
    },
  )

  // ─── OCR endpoint ──────────────────────────────────
  .post(
    "/ocr",
    async ({ body }) => {
      const { pageId, capturedImage, region } = body;

      const base64Data = capturedImage.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const ocrService = MangaOCRService.getInstance();
      const translationService = TranslationService.getInstance();

      let rawText = "";
      let translatedText: string | null = null;
      let ocrWarning: string | undefined;

      const [ocrError, ocrResult] = await catchError(
        ocrService.extractText(buffer),
      );

      if (ocrError) {
        console.error("OCR Error:", ocrError);
        ocrWarning = `OCR failed: ${ocrError.message}`;
      } else {
        rawText = ocrResult;

        const [translateError, translateResult] = await catchError(
          translationService.translate(rawText),
        );

        if (translateError) {
          console.error("Translation Error:", translateError);
          ocrWarning = `Translation failed: ${translateError.message}`;
        } else {
          translatedText = translateResult || null;
        }
      }

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
        console.error("Caption Error:", captionError);
        return {
          success: false,
          error: captionError.message,
        };
      }

      return {
        success: true,
        captionId: caption.id,
        captionSlug: caption.slug,
        rawText: caption.rawText,
        translatedText: caption.translatedText,
        warning: ocrWarning,
      };
    },
    {
      body: t.Object({
        pageId: t.Number(),
        capturedImage: t.String(),
        region: tRegion,
      }),
    },
  )

  // ─── Merge endpoint ────────────────────────────────
  .patch(
    "/merge",
    async ({ body }) => {
      const { pageSlug } = body;

      const [pageError, page] = await catchError(
        PageStore.findBySlug(pageSlug),
      );
      if (pageError || !page) {
        return { success: false, error: "Page not found" };
      }

      const [captionsError, captions] = await catchError(
        CaptionStore.findByPageId(page.id),
      );
      if (captionsError) {
        return { success: false, error: captionsError.message };
      }

      const captionsWithPatches = captions.filter((c) => c.patchImagePath);
      if (captionsWithPatches.length === 0) {
        return { success: false, error: "No patches to merge" };
      }

      // Load original page image
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
        };
      }

      const pageImageBase64 = Buffer.from(imageFile).toString("base64");

      // Prepare patches — coords are already in image-pixel space
      const patches = [];
      for (const caption of captionsWithPatches) {
        if (!caption.patchImagePath) continue;

        const patchPath = join(
          envConfig.MANGA_DIR,
          caption.patchImagePath.replace("/uploads/", ""),
        );

        const [patchError, patchFile] = await catchError(
          Bun.file(patchPath).arrayBuffer(),
        );
        if (patchError) {
          console.warn(`Failed to load patch: ${caption.patchImagePath}`);
          continue;
        }

        const bounds = getRegionBounds(caption.region);

        patches.push({
          patchImageBase64: Buffer.from(patchFile).toString("base64"),
          x: bounds.x,
          y: bounds.y,
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        });
      }

      if (patches.length === 0) {
        return { success: false, error: "Failed to load any patches" };
      }

      // Merge via Python service
      const patchService = PatchGeneratorService.getInstance();
      const [mergeError, mergedImageBase64] = await catchError(
        patchService.mergePatches(pageImageBase64, patches),
      );
      if (mergeError) {
        return {
          success: false,
          error: `Failed to merge patches: ${mergeError.message}`,
        };
      }

      // Overwrite original image
      const [saveError] = await catchError(
        Bun.write(pageImagePath, Buffer.from(mergedImageBase64, "base64")),
      );
      if (saveError) {
        return {
          success: false,
          error: `Failed to save merged image: ${saveError.message}`,
        };
      }

      // Delete all captions for the page
      for (const caption of captions) {
        await CaptionStore.deleteBySlug(caption.slug!);
      }

      // Delete patches directory
      const chapter = await ChapterStore.findById(page.chapterId);
      if (chapter) {
        const patchesDir = join(
          envConfig.MANGA_DIR,
          chapter.seriesId.toString(),
          "chapters",
          chapter.id.toString(),
          "patches",
        );
        await catchError(rm(patchesDir, { recursive: true, force: true }));
      }

      return {
        success: true,
        message: `Successfully merged ${patches.length} patches`,
      };
    },
    {
      body: t.Object({
        pageSlug: t.String(),
      }),
    },
  )

  // ─── Re-extract OCR endpoint ───────────────────────
  .post(
    "/extract",
    async ({ body }) => {
      const { captionSlug } = body;

      const [captionError, caption] = await catchError(
        CaptionStore.findBySlug(captionSlug),
      );
      if (captionError || !caption) {
        return { success: false, error: "Caption not found" };
      }

      const base64Data = caption.capturedImage.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      const buffer = Buffer.from(base64Data, "base64");

      const ocrService = MangaOCRService.getInstance();
      const translationService = TranslationService.getInstance();

      const [ocrError, rawText] = await catchError(
        ocrService.extractText(buffer),
      );
      if (ocrError) {
        return { success: false, error: `OCR failed: ${ocrError.message}` };
      }

      const [translateError, translatedText] = await catchError(
        translationService.translate(rawText),
      );
      if (translateError) {
        console.warn("Translation failed after re-extract:", translateError);
      }

      const [updateError, updated] = await catchError(
        CaptionStore.updateBySlug(captionSlug, {
          rawText,
          translatedText: translatedText || null,
        }),
      );
      if (updateError || !updated) {
        return { success: false, error: "Failed to update caption" };
      }

      return {
        success: true,
        caption: updated,
      };
    },
    {
      body: t.Object({
        captionSlug: t.String(),
      }),
    },
  )

  // ─── Delete patch endpoint ─────────────────────────
  .delete("/captions/:slug/patch", async ({ params: { slug } }) => {
    const [captionError, caption] = await catchError(
      CaptionStore.findBySlug(slug),
    );
    if (captionError || !caption) {
      return { success: false, error: "Caption not found" };
    }

    if (!caption.patchImagePath) {
      return { success: false, error: "Caption has no patch" };
    }

    // Delete patch file from disk
    const patchPath = join(
      envConfig.MANGA_DIR,
      caption.patchImagePath.replace("/uploads/", ""),
    );
    await catchError(
      Bun.file(patchPath)
        .exists()
        .then(async (exists) => {
          if (exists) {
            const { unlink } = await import("node:fs/promises");
            await unlink(patchPath);
          }
        }),
    );

    // Clear patch fields in DB
    const [updateError] = await catchError(
      CaptionStore.updateBySlug(slug, {
        patchImagePath: null,
        patchGeneratedAt: null,
      } as any),
    );
    if (updateError) {
      return { success: false, error: "Failed to clear patch data" };
    }

    return { success: true };
  })

  // ─── Inpaint endpoint ──────────────────────────────
  .post(
    "/inpaint",
    async ({ body }) => {
      const { pageId, pageImageBase64, maskImageBase64 } = body;

      // Convert base64 to blobs
      const pageBlob = new Blob(
        [Buffer.from(pageImageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64")],
        { type: "image/png" }
      );
      const maskBlob = new Blob(
        [Buffer.from(maskImageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64")],
        { type: "image/png" }
      );

      // Call MangaOCRAPI via Unix socket
      const ocrAPI = MangaOCRAPI;
      const [inpaintError, cleanedImageBase64] = await catchError(
        ocrAPI.inpaintMask(pageBlob, maskBlob),
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
        "base64"
      );

      // Strip /uploads/ prefix to get relative path
      const relativePath = page.originalImage.replace("/uploads/", "");
      const imagePath = join(envConfig.MANGA_DIR, relativePath);

      const [writeError] = await catchError(
        Bun.write(imagePath, cleanedImageBuffer)
      );

      if (writeError) {
        console.error("Failed to save cleaned image:", writeError);
        return {
          success: false,
          error: "Failed to save cleaned image",
        };
      }

      // Clear mask data from page data
      const [pageDataError, pageData] = await catchError(
        PageDataStore.findByPageId(pageId)
      );

      if (pageData) {
        const [deleteError] = await catchError(
          PageDataStore.delete(pageData.id)
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
  );
