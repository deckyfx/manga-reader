import Elysia, { t } from "elysia";
import { env } from "@/env";
import { bootState } from "@/boot-state";
import { ModelInfoSchema } from "@/lib/schemas";
import { runtimeSettings } from "@/stores/settings-store";

const SettingsSchema = t.Object({
  ocr: ModelInfoSchema,
  translate: ModelInfoSchema,
  inpaint: ModelInfoSchema,
  bubble: ModelInfoSchema,
  text_seg: ModelInfoSchema,
  preferred_translation_engine: t.String(),
  inpaint_engine: t.String(),
  deepl_configured: t.Boolean(),
});

function currentSettings() {
  return {
    ocr: {
      repo: env.OCR_MODEL_REPO,
      dir: env.OCR_MODELS_DIR,
      enabled: env.OCR_MODEL_ENABLED,
      files: env.OCR_MODEL_FILES,
      ready: bootState.ocrReady,
    },
    translate: {
      repo: env.TRANSLATE_MODEL_REPO,
      dir: env.TRANSLATE_MODELS_DIR,
      enabled: env.TRANSLATE_MODEL_ENABLED,
      files: env.TRANSLATE_MODEL_FILES,
      ready: bootState.translateReady,
    },
    inpaint: {
      repo: env.INPAINT_MODEL_REPO,
      dir: env.INPAINT_MODELS_DIR,
      enabled: env.INPAINT_MODEL_ENABLED,
      files: env.INPAINT_MODEL_FILES,
      ready: bootState.inpaintReady,
    },
    bubble: {
      repo: env.BUBBLE_MODEL_REPO,
      dir: env.BUBBLE_MODELS_DIR,
      enabled: env.BUBBLE_MODEL_ENABLED,
      files: env.BUBBLE_MODEL_FILES,
      ready: bootState.bubbleReady,
    },
    text_seg: {
      repo: env.TEXT_SEG_MODEL_REPO,
      dir: env.TEXT_SEG_MODELS_DIR,
      enabled: env.TEXT_SEG_MODEL_ENABLED,
      files: env.TEXT_SEG_MODEL_FILES,
      ready: bootState.textSegReady,
    },
    preferred_translation_engine: runtimeSettings.preferredTranslationEngine,
    inpaint_engine: runtimeSettings.inpaintEngine,
    deepl_configured: !!env.DEEPL_API_KEY,
  };
}

export const routeSettings = new Elysia({ prefix: "/api/settings" })
  .get("/", () => currentSettings(), { response: { 200: SettingsSchema } })
  .patch(
    "/engine",
    ({ body, status: error }) => {
      const allowed = ["auto", "local", "deepl"] as const;
      if (!allowed.includes(body.engine as typeof allowed[number]))
        return error(400, { error: `engine must be one of: ${allowed.join(", ")}` });
      runtimeSettings.preferredTranslationEngine = body.engine as typeof runtimeSettings.preferredTranslationEngine;
      return { preferred_translation_engine: body.engine };
    },
    { body: t.Object({ engine: t.String() }) },
  )
  .patch(
    "/inpaint-engine",
    ({ body, status: error }) => {
      const allowed = ["auto", "lama", "flood_fill"] as const;
      if (!allowed.includes(body.engine as typeof allowed[number]))
        return error(400, { error: `engine must be one of: ${allowed.join(", ")}` });
      runtimeSettings.inpaintEngine = body.engine as typeof runtimeSettings.inpaintEngine;
      return { inpaint_engine: body.engine };
    },
    { body: t.Object({ engine: t.String() }) },
  );
