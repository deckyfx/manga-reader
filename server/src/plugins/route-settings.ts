import Elysia, { t } from "elysia";
import { env } from "@/env";
import { bootState } from "@/boot-state";
import { ModelInfoSchema } from "@/lib/schemas";
import { INPAINT_ENGINES, runtimeSettings, setRuntimeEngine, TRANSLATION_ENGINES } from "@/stores/settings-store";

const SettingsSchema = t.Object({
  ocr: ModelInfoSchema,
  translate: ModelInfoSchema,
  inpaint: ModelInfoSchema,
  bubble: ModelInfoSchema,
  text_seg: ModelInfoSchema,
  preferred_translation_engine: t.String(),
  sugoi_configured: t.Boolean(),
  sugoi_url: t.String(),
  inpaint_engine: t.String(),
  deepl_configured: t.Boolean(),
  /**
   * What this build can do, so a client can tell a missing feature from a broken one. The extension reads this
   * before a chapter import: an older server has no `workspaces`, and the popup says to update it rather than
   * failing halfway through uploading.
   */
  capabilities: t.Object({ workspaces: t.Boolean() }),
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
    /** A self-hosted Sugoi server is configured (SUGOI_URL); its address, for the settings page to show. */
    sugoi_configured: !!env.SUGOI_URL,
    sugoi_url: env.SUGOI_URL,
    capabilities: { workspaces: true },
  };
}

export const routeSettings = new Elysia({ prefix: "/api/settings" })
  .get("/", () => currentSettings(), { response: { 200: SettingsSchema } })
  .patch(
    "/engine",
    async ({ body, status: error }) => {
      if (!TRANSLATION_ENGINES.includes(body.engine as (typeof TRANSLATION_ENGINES)[number]))
        return error(400, { error: `engine must be one of: ${TRANSLATION_ENGINES.join(", ")}` });
      await setRuntimeEngine("translation", body.engine);
      return { preferred_translation_engine: body.engine };
    },
    { body: t.Object({ engine: t.String() }) },
  )
  .patch(
    "/inpaint-engine",
    async ({ body, status: error }) => {
      if (!INPAINT_ENGINES.includes(body.engine as (typeof INPAINT_ENGINES)[number]))
        return error(400, { error: `engine must be one of: ${INPAINT_ENGINES.join(", ")}` });
      await setRuntimeEngine("inpaint", body.engine);
      return { inpaint_engine: body.engine };
    },
    { body: t.Object({ engine: t.String() }) },
  );
