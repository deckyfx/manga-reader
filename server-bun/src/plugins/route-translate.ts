import Elysia, { t } from "elysia";
import { bootState } from "@/boot-state";
import { inferenceQueue } from "@/queue/inference-queue";
import { OcrStore } from "@/stores/ocr-store";
import { ErrBody } from "@/lib/schemas";
import { env } from "@/env";
import { runtimeSettings } from "@/stores/settings-store";

export const routeTranslate = new Elysia().post(
  "/translate",
  async ({ body, status: error }) => {
    const text = body.text?.trim();
    if (!text) return error(400, { error: "text is required" });

    const allowedEngines = ["auto", "local", "deepl"] as const;
    const requestedEngine = body.translate_engine?.toLowerCase();
    if (requestedEngine !== undefined && !allowedEngines.includes(requestedEngine as typeof allowedEngines[number]))
      return error(400, { error: `translate_engine must be one of: ${allowedEngines.join(", ")}` });

    // Fall back to runtime-mutable setting (not env) when engine is omitted.
    const effective = (requestedEngine ?? runtimeSettings.preferredTranslationEngine) as string;
    const resolvedEngine = effective === "auto"
      ? env.DEEPL_API_KEY ? "deepl" : "local"
      : effective;

    // DeepL requested but key absent → fall back to local.
    const finalEngine = (resolvedEngine === "deepl" && !env.DEEPL_API_KEY) ? "local" : resolvedEngine;
    if (finalEngine !== "deepl" && !bootState.translateReady)
      return error(503, { error: "Translate model not ready" });

    const result = await inferenceQueue.enqueue<
      { text: string; engine: string },
      { translatedText: string; engine: string; processingTimeMs: number }
    >("translate", { text, engine: finalEngine });

    OcrStore.insertTranslateLog({
      sourceText: text,
      translatedText: result.translatedText,
      sourceLang: "ja",
      targetLang: "en",
      engine: result.engine,
      processingTimeMs: result.processingTimeMs,
    }).catch(() => {});

    return {
      translation: result.translatedText,
      engine: result.engine,
      elapsed_ms: result.processingTimeMs,
    };
  },
  {
    body: t.Object({
      text: t.String(),
      translate_engine: t.Optional(t.String()),
    }),
    response: {
      200: t.Object({
        translation: t.String(),
        engine: t.String(),
        elapsed_ms: t.Integer(),
      }),
      400: ErrBody,
      503: ErrBody,
    },
  },
);
