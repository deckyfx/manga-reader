import { Elysia, t } from "elysia";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envConfig } from "../env-config";
import { OcrResultManager } from "../services/OcrResultManager";
import { TranslationService } from "../services/TranslationService";
import { PageStore } from "../stores/page-store";
import { CaptionStore } from "../stores/caption-store";

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
  });
