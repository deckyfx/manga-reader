import { Elysia, t } from "elysia";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envConfig } from "../env-config";
import { OcrResultManager } from "../services/OcrResultManager";
import { TranslationService } from "../services/TranslationService";

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
        const { image } = body;

        // Convert File to Buffer
        const arrayBuffer = await image.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

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
          const text = await resultManager.waitForResult(filename, 5000);

          // Translate the extracted text
          const translatedText = await translationService.translate(text);

          return {
            success: true,
            text,
            translatedText,
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
        image: t.File({
          type: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
          maxSize: 10 * 1024 * 1024, // 10MB max
        }),
      }),
    }
  );
