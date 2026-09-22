/**
 * The OCR and translation engines, loaded for the command-line tools (scripts/page.ts, scripts/regress.ts) the way
 * the server loads them, and called through the same inference queue.
 */
import { env } from "@/env";
import { inferenceHandlers } from "@/queue/inference-queue";
import type { PipelineEngines } from "@/services/page-pipeline";

const signal = new AbortController().signal;

export async function ocrEngine(): Promise<PipelineEngines["ocr"]> {
  process.env.OCR_DEBUG = "false";
  const load = env.OCR_ENGINE === "baberu"
    ? (await import("@/services/baberu-ocr-service")).loadBaberuOcrModel
    : (await import("@/services/ocr-service")).loadOcrModel;
  await load();
  return async (image) => ((await inferenceHandlers.ocr({ imageBuffer: image }, signal)) as { text: string }).text;
}

export async function translateEngine(): Promise<PipelineEngines["translate"]> {
  const { loadTranslateModel } = await import("@/services/translate-service");
  await loadTranslateModel();
  return async (text) => {
    const out = (await inferenceHandlers.translate({ text }, signal)) as { translatedText: string; engine: string };
    return { text: out.translatedText, engine: out.engine };
  };
}
