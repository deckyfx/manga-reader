/**
 * OCR Service - Flexible text extraction with multiple engine support
 *
 * Supports:
 * - Tesseract.js (Node.js, slower but no dependencies)
 * - Native Tesseract CLI (C++, fast with custom models)
 * - Python pytesseract (via subprocess, good for fine-tuned models)
 * - Custom trained models for Japanese manga
 * - Vertical and horizontal text orientations
 */

import { $ } from "bun";
import Tesseract from "tesseract.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

/**
 * OCR Engine types
 */
export type OCREngine = "tesseract-js" | "tesseract-cli" | "python";

/**
 * Text orientation for Japanese text
 */
export type TextOrientation = "horizontal" | "vertical" | "auto";

/**
 * Page Segmentation Mode (PSM)
 * @see https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html#page-segmentation-method
 */
export enum PageSegmentationMode {
  OSD_ONLY = 0, // Orientation and script detection only
  AUTO_OSD = 1, // Auto page segmentation with OSD
  AUTO = 3, // Fully automatic page segmentation (default)
  SINGLE_COLUMN = 4, // Single column of text
  SINGLE_BLOCK_VERT = 5, // Single uniform block of vertically aligned text
  SINGLE_BLOCK = 6, // Single uniform block of text
  SINGLE_LINE = 7, // Single text line
  SINGLE_WORD = 8, // Single word
  CIRCLE_WORD = 9, // Single word in a circle
  SINGLE_CHAR = 10, // Single character
  SPARSE_TEXT = 11, // Sparse text (find as much text as possible)
  SPARSE_TEXT_OSD = 12, // Sparse text with OSD
  RAW_LINE = 13, // Raw line (treat image as single text line)
}

/**
 * OCR Configuration
 */
export interface OCRConfig {
  /** OCR engine to use */
  engine?: OCREngine;
  /** Language code (e.g., 'eng', 'jpn', 'jpn_vert') */
  language?: string;
  /** Text orientation (for Japanese) */
  orientation?: TextOrientation;
  /** Page segmentation mode */
  psm?: PageSegmentationMode;
  /** Path to custom trained model (.traineddata) */
  customModelPath?: string;
  /** Additional Tesseract config parameters */
  tesseractConfig?: Record<string, string | number>;
  /** Enable debug output */
  debug?: boolean;
}

/**
 * OCR Result
 */
export interface OCRResult {
  text: string;
  confidence: number;
  engine: OCREngine;
  language: string;
  orientation?: TextOrientation;
  words?: number;
  processingTime?: number;
}

/**
 * Check if native Tesseract CLI is available
 */
async function isTesseractCLIAvailable(): Promise<boolean> {
  try {
    const result = await $`tesseract --version`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if Python pytesseract is available
 */
async function isPythonTesseractAvailable(): Promise<boolean> {
  try {
    const result = await $`python3 -c "import pytesseract; print(pytesseract.get_tesseract_version())"`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get appropriate language code based on orientation
 */
function getLanguageCode(language: string, orientation?: TextOrientation): string {
  // For Japanese, use jpn_vert for vertical text
  if (language === "jpn" || language === "ja") {
    if (orientation === "vertical") {
      return "jpn_vert";
    }
    return "jpn";
  }
  return language;
}

/**
 * Run OCR using Tesseract.js (Node.js implementation)
 */
async function runTesseractJS(
  imageBuffer: Buffer,
  config: OCRConfig
): Promise<OCRResult> {
  const startTime = Date.now();
  const language = getLanguageCode(config.language || "eng", config.orientation);

  const result = await Tesseract.recognize(imageBuffer, language, {
    ...config.tesseractConfig,
  });

  const wordCount = result.data.text.trim().split(/\s+/).filter(w => w.length > 0).length;

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    engine: "tesseract-js",
    language,
    orientation: config.orientation,
    words: wordCount,
    processingTime: Date.now() - startTime,
  };
}

/**
 * Run OCR using native Tesseract CLI (C++ implementation)
 * Much faster and supports custom trained models
 */
async function runTesseractCLI(
  imageBuffer: Buffer,
  config: OCRConfig
): Promise<OCRResult> {
  const startTime = Date.now();
  const language = getLanguageCode(config.language || "eng", config.orientation);

  // Create temporary file for image
  const tempDir = join(process.cwd(), "temp");
  const timestamp = Date.now();
  const imagePath = join(tempDir, `ocr_input_${timestamp}.png`);
  const outputBase = join(tempDir, `ocr_output_${timestamp}`);
  const outputPath = `${outputBase}.txt`;

  try {
    // Ensure temp directory exists
    await $`mkdir -p ${tempDir}`;

    // Write image to temp file
    await Bun.write(imagePath, imageBuffer);

    // Build Tesseract command
    let cmd = `tesseract ${imagePath} ${outputBase}`;
    cmd += ` -l ${language}`;

    if (config.psm !== undefined) {
      cmd += ` --psm ${config.psm}`;
    }

    // Add custom model path if provided
    if (config.customModelPath && existsSync(config.customModelPath)) {
      cmd += ` --tessdata-dir ${config.customModelPath}`;
    }

    // Add additional config parameters
    if (config.tesseractConfig) {
      for (const [key, value] of Object.entries(config.tesseractConfig)) {
        cmd += ` -c ${key}=${value}`;
      }
    }

    if (config.debug) {
      console.log("Tesseract CLI command:", cmd);
    }

    // Run Tesseract
    const result = await $`sh -c ${cmd}`;

    // Read output text
    const text = await Bun.file(outputPath).text();
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;

    // Clean up temp files
    await $`rm -f ${imagePath} ${outputPath}`;

    return {
      text,
      confidence: 0, // CLI doesn't provide confidence by default
      engine: "tesseract-cli",
      language,
      orientation: config.orientation,
      words: wordCount,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    // Clean up on error
    await $`rm -f ${imagePath} ${outputPath}`.quiet();
    throw error;
  }
}

/**
 * Run OCR using Python pytesseract
 */
async function runPythonTesseract(
  imageBuffer: Buffer,
  config: OCRConfig
): Promise<OCRResult> {
  const startTime = Date.now();
  const language = getLanguageCode(config.language || "eng", config.orientation);

  // Create temporary file for image
  const tempDir = join(process.cwd(), "temp");
  const timestamp = Date.now();
  const imagePath = join(tempDir, `ocr_input_${timestamp}.png`);

  try {
    // Ensure temp directory exists
    await $`mkdir -p ${tempDir}`;

    // Write image to temp file
    await Bun.write(imagePath, imageBuffer);

    // Build Python command
    let pythonCmd = `
import pytesseract
from PIL import Image

# Configure
config = "--psm ${config.psm || PageSegmentationMode.AUTO}"
`;

    if (config.customModelPath) {
      pythonCmd += `pytesseract.pytesseract.tessdata_dir_config = '--tessdata-dir "${config.customModelPath}"'\n`;
    }

    pythonCmd += `
# Run OCR
image = Image.open("${imagePath}")
text = pytesseract.image_to_string(image, lang="${language}", config=config)
print(text)
`;

    // Run Python script
    const result = await $`python3 -c ${pythonCmd}`;
    const text = result.stdout.toString();
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;

    // Clean up
    await $`rm -f ${imagePath}`;

    return {
      text,
      confidence: 0,
      engine: "python",
      language,
      orientation: config.orientation,
      words: wordCount,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    await $`rm -f ${imagePath}`.quiet();
    throw error;
  }
}

/**
 * Main OCR function - automatically selects best available engine
 */
export async function runOCR(
  imageBuffer: Buffer,
  config: OCRConfig = {}
): Promise<OCRResult> {
  const engine = config.engine || "tesseract-cli"; // Prefer CLI by default

  try {
    switch (engine) {
      case "tesseract-cli":
        if (await isTesseractCLIAvailable()) {
          return await runTesseractCLI(imageBuffer, config);
        }
        console.warn("Tesseract CLI not available, falling back to Tesseract.js");
        return await runTesseractJS(imageBuffer, config);

      case "python":
        if (await isPythonTesseractAvailable()) {
          return await runPythonTesseract(imageBuffer, config);
        }
        console.warn("Python pytesseract not available, falling back to Tesseract.js");
        return await runTesseractJS(imageBuffer, config);

      case "tesseract-js":
      default:
        return await runTesseractJS(imageBuffer, config);
    }
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error(`OCR processing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Get available OCR engines
 */
export async function getAvailableEngines(): Promise<OCREngine[]> {
  const engines: OCREngine[] = ["tesseract-js"]; // Always available

  if (await isTesseractCLIAvailable()) {
    engines.push("tesseract-cli");
  }

  if (await isPythonTesseractAvailable()) {
    engines.push("python");
  }

  return engines;
}

/**
 * Preset configurations for common use cases
 */
export const OCRPresets = {
  /** English horizontal text */
  englishHorizontal: {
    language: "eng",
    psm: PageSegmentationMode.AUTO,
    orientation: "horizontal" as TextOrientation,
  },

  /** Japanese horizontal text (modern) */
  japaneseHorizontal: {
    language: "jpn",
    psm: PageSegmentationMode.AUTO,
    orientation: "horizontal" as TextOrientation,
  },

  /** Japanese vertical text (manga, traditional) */
  japaneseVertical: {
    language: "jpn_vert",
    psm: PageSegmentationMode.SINGLE_BLOCK_VERT,
    orientation: "vertical" as TextOrientation,
  },

  /** Japanese manga with custom model */
  japaneseManga: (modelPath: string) => ({
    language: "jpn_vert",
    psm: PageSegmentationMode.SPARSE_TEXT,
    orientation: "vertical" as TextOrientation,
    customModelPath: modelPath,
  }),

  /** Single line text */
  singleLine: {
    language: "eng",
    psm: PageSegmentationMode.SINGLE_LINE,
  },
};
