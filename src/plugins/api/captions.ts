import { Elysia, t } from "elysia";
import { MangaOCRService } from "../../services/MangaOCRService";
import { TranslationService } from "../../services/TranslationService";
import { CaptionStore } from "../../stores/caption-store";
import { catchError } from "../../lib/error-handler";

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
  });

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
