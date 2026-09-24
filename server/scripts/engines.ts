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

export async function translateEngine(): Promise<Pick<PipelineEngines, "translate" | "batchSize">> {
  const { loadTranslateModel, translationBatchSize } = await import("@/services/translate-service");
  await loadTranslateModel();
  return {
    translate: async (texts) => {
      const out = (await inferenceHandlers.translate({ texts }, signal)) as { translations: string[]; engine: string };
      return { texts: out.translations, engine: out.engine };
    },
    batchSize: translationBatchSize,
  };
}
