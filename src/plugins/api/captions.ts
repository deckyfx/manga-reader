import { Elysia, t } from "elysia";
import { MangaOCRService } from "../../services/MangaOCRService";
import { PatchGeneratorService } from "../../services/PatchGeneratorService";
import { TranslationService } from "../../services/TranslationService";
import { CaptionStore } from "../../stores/caption-store";
import { PageStore } from "../../stores/page-store";
import { ChapterStore } from "../../stores/chapter-store";
import { catchError } from "../../lib/error-handler";
import { envConfig } from "../../env-config";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

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
  strokeWidth: number
): Promise<string> {
  // Get caption data
  const caption = await CaptionStore.findBySlug(captionSlug);
  if (!caption) {
    throw new Error("Caption not found");
  }

  // Get page and chapter info to determine save path
  const page = await PageStore.findById(caption.pageId);
  if (!page) {
    throw new Error("Page not found");
  }

  const chapter = await ChapterStore.findById(page.chapterId);
  if (!chapter) {
    throw new Error("Chapter not found");
  }

  // Generate patch using PatchGeneratorService with manual parameters
  const patchService = PatchGeneratorService.getInstance();
  const base64Data = caption.capturedImage.replace(/^data:image\/\w+;base64,/, "");

  const patchImageBase64 = await patchService.generatePatch(
    base64Data,
    lines,
    fontSize,
    fontType,
    textColor,
    strokeColor,
    strokeWidth
  );

  // Create patches directory if it doesn't exist
  const patchesDir = join(
    envConfig.MANGA_DIR,
    chapter.seriesId.toString(),
    "chapters",
    chapter.id.toString(),
    "patches"
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
 * Caption and OCR API endpoints
 */
export const captionsApi = new Elysia({ prefix: "/captions" })
  .get(
    "/",
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
    "/:slug",
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
  .delete("/:slug", async ({ params: { slug } }) => {
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
  .post("/:slug/retry-translate", async ({ params: { slug } }) => {
    // Get caption
    const [captionError, caption] = await catchError(CaptionStore.findBySlug(slug));

    if (captionError || !caption) {
      return {
        success: false,
        error: "Caption not found",
      };
    }

    // Retry translation with the original raw text
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

    // Update caption with new translation
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
    "/:slug/generate-patch",
    async ({ params: { slug }, body }) => {
      // Check if patch generator is available
      const patchService = PatchGeneratorService.getInstance();
      const [availError, isAvailable] = await catchError(patchService.isAvailable());

      if (availError || !isAvailable) {
        return {
          success: false,
          error: "Patch generator service is not available",
        };
      }

      // Generate and save patch with manual parameters
      const [error, patchUrl] = await catchError(
        generateAndSavePatch(
          slug,
          body.lines,
          body.fontSize,
          body.fontType,
          body.textColor,
          body.strokeColor,
          body.strokeWidth
        )
      );

      if (error) {
        console.error("Generate patch error:", error);
        return {
          success: false,
          error: error.message,
        };
      }

      // Get updated caption with patch info
      const [captionError, caption] = await catchError(CaptionStore.findBySlug(slug));

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
        fontType: t.Union([t.Literal("regular"), t.Literal("bold"), t.Literal("italic")]),
        textColor: t.String(),
        strokeColor: t.Nullable(t.String()),
        strokeWidth: t.Number(),
      }),
    }
  );

/**
 * OCR API endpoint (separate from captions prefix)
 */
export const ocrApi = new Elysia({ prefix: "/ocr" }).post(
  "/",
  async ({ body }) => {
    const { pageId, imagePath, x, y, width, height, capturedImage } = body;

    // Decode base64 image
    const base64Data = capturedImage.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Get MangaOCRService instance
    const ocrService = MangaOCRService.getInstance();
    const translationService = TranslationService.getInstance();

    // Extract text using the new OCR service (direct socket communication)
    const [ocrError, rawText] = await catchError(
      ocrService.extractText(buffer),
    );

    if (ocrError) {
      console.error("OCR Error:", ocrError);
      return {
        success: false,
        error: ocrError.message,
      };
    }

    // Translate the extracted text
    const [translateError, translatedText] = await catchError(
      translationService.translate(rawText),
    );

    if (translateError) {
      console.error("Translation Error:", translateError);
      return {
        success: false,
        error: translateError.message,
      };
    }

    // Save caption to database
    const [captionError, caption] = await catchError(
      CaptionStore.create({
        pageId,
        x,
        y,
        width,
        height,
        capturedImage,
        rawText,
        translatedText: translatedText || null,
      }),
    );

    if (captionError) {
      console.error("Caption Error:", captionError);
      return {
        success: false,
        error: captionError.message,
      };
    }

    // Patch generation is now manual only - removed auto-generation

    return {
      success: true,
      captionId: caption.id,
      captionSlug: caption.slug,
      rawText: caption.rawText,
      translatedText: caption.translatedText,
    };
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
);
