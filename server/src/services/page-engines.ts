import { bootState } from "@/boot-state";
import { inferenceQueue } from "@/queue/inference-queue";
import type { PipelineEngines } from "@/services/page-pipeline";
import { translationBatchSize } from "@/services/translate-service";
import { resolveTranslationEngine } from "@/services/translation-engine";

/** OCR and translation go through the inference queue so page work doesn't race single bubble requests. */
export const pageEngines: PipelineEngines = {
  ocr: async (image) => (await inferenceQueue.enqueue<{ imageBuffer: Buffer }, { text: string }>("ocr", { imageBuffer: image })).text,
  translate: async (texts) => {
    const out = await inferenceQueue.enqueue<{ texts: string[] }, { translations: string[]; engine: string }>("translate", { texts });
    return { texts: out.translations, engine: out.engine };
  },
  batchSize: translationBatchSize,
};

/** Message for a 503 when OCR or translation models aren't loaded yet, or null when both are ready. */
export function enginesNotReady(): string | null {
  if (!bootState.ocrReady) return "Server not ready — models still loading";
  // Only the built-in model has anything to wait for: a server translating through DeepL or Sugoi is ready to work
  // on pages whether or not it ever loaded one
  if (resolveTranslationEngine() === "local" && !bootState.translateReady) return "Server not ready — models still loading";
  return null;
}
