import { Elysia, t } from "elysia";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runOCR,
  getAvailableEngines,
  OCRPresets,
  PageSegmentationMode,
  type OCREngine,
  type TextOrientation,
} from "../services/ocrService";

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
        const {
          image,
          language = "eng",
          orientation = "auto",
          engine = "tesseract-cli",
          psm,
          customModelPath,
          preset,
        } = body;

        // Convert File to Buffer
        const arrayBuffer = await image.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Create cropped images directory if it doesn't exist
        const croppedDir = join(process.cwd(), "src/public/uploads/cropped");
        await mkdir(croppedDir, { recursive: true });

        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const filename = `cropped_${timestamp}.png`;
        const filepath = join(croppedDir, filename);

        // Save the cropped image to disk
        await writeFile(filepath, buffer);
        console.log(`Saved cropped image: ${filepath}`);

        // Build OCR configuration
        let ocrConfig = {
          engine: engine as OCREngine,
          language,
          orientation: orientation as TextOrientation,
          psm: psm as PageSegmentationMode | undefined,
          customModelPath,
          debug: true,
        };

        // Apply preset if provided
        if (preset === "japaneseVertical") {
          ocrConfig = { ...ocrConfig, ...OCRPresets.japaneseVertical };
        } else if (preset === "japaneseHorizontal") {
          ocrConfig = { ...ocrConfig, ...OCRPresets.japaneseHorizontal };
        } else if (preset === "japaneseManga" && customModelPath) {
          ocrConfig = { ...ocrConfig, ...OCRPresets.japaneseManga(customModelPath) };
        }

        // Run OCR with flexible service
        const result = await runOCR(buffer, ocrConfig);

        return {
          success: true,
          text: result.text,
          confidence: result.confidence,
          words: result.words,
          engine: result.engine,
          language: result.language,
          orientation: result.orientation,
          processingTime: result.processingTime,
          savedAs: filename,
          path: `/uploads/cropped/${filename}`,
        };
      } catch (error) {
        console.error("OCR Error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "OCR processing failed",
          text: "",
        };
      }
    },
    {
      body: t.Object({
        image: t.File({
          type: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
          maxSize: 10 * 1024 * 1024, // 10MB max
        }),
        language: t.Optional(t.String({ default: "eng" })),
        orientation: t.Optional(t.String({ default: "auto" })),
        engine: t.Optional(t.String({ default: "tesseract-cli" })),
        psm: t.Optional(t.Number()),
        customModelPath: t.Optional(t.String()),
        preset: t.Optional(t.String()),
      }),
    }
  )
  .get("/ocr/engines", async () => {
    const engines = await getAvailableEngines();
    return {
      available: engines,
      default: engines.includes("tesseract-cli") ? "tesseract-cli" : "tesseract-js",
    };
  })
  .get("/ocr/presets", () => {
    return {
      presets: {
        englishHorizontal: "English horizontal text",
        japaneseHorizontal: "Japanese horizontal text (modern)",
        japaneseVertical: "Japanese vertical text (manga, traditional)",
        japaneseManga: "Japanese manga with custom model",
        singleLine: "Single line text",
      },
    };
  });
