import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "@/env";
import { bootState } from "@/boot-state";
import { routeHealth } from "@/plugins/route-health";
import { routeOcr } from "@/plugins/route-ocr";
import { routeTranslate } from "@/plugins/route-translate";
import { routeSettings } from "@/plugins/route-settings";
import { routeTranslatePage } from "@/plugins/route-translate-page";
import { portalPlugin } from "@/plugins/portal/index";
import { routeSpa } from "@/plugins/route-spa";

async function migrateDb(): Promise<void> {
  const { MigrationManager } = await import("@/db/migration-manager");
  await MigrationManager.init();
}

async function loadModels(): Promise<void> {
  bootState.inpaintEnabled = env.INPAINT_MODEL_ENABLED;
  bootState.bubbleEnabled = env.BUBBLE_MODEL_ENABLED;
  bootState.textSegEnabled = env.TEXT_SEG_MODEL_ENABLED;

  const { downloadHfModel, downloadFile, printDownloadPlan } = await import("@/services/model-downloader");

  // Build download entries for enabled models and print plan before starting.
  const entries = [
    env.OCR_MODEL_ENABLED && { repo: env.OCR_MODEL_REPO, dir: env.OCR_MODELS_DIR, files: env.OCR_MODEL_FILES, label: "OCR" },
    env.TRANSLATE_MODEL_ENABLED && { repo: env.TRANSLATE_MODEL_REPO, dir: env.TRANSLATE_MODELS_DIR, files: env.TRANSLATE_MODEL_FILES, label: "Translate" },
    env.INPAINT_MODEL_ENABLED && { repo: env.INPAINT_MODEL_REPO, dir: env.INPAINT_MODELS_DIR, files: env.INPAINT_MODEL_FILES, label: "Inpaint" },
    env.BUBBLE_MODEL_ENABLED && { repo: env.BUBBLE_MODEL_REPO, dir: env.BUBBLE_MODELS_DIR, files: env.BUBBLE_MODEL_FILES, label: "Bubble" },
    env.TEXT_SEG_MODEL_ENABLED && { repo: "", dir: env.TEXT_SEG_MODELS_DIR, files: env.TEXT_SEG_MODEL_FILES, label: "TextSeg" },
  ].filter(Boolean) as { repo: string; dir: string; files: string[]; label: string }[];

  printDownloadPlan(entries);

  // Download each enabled model from HuggingFace before loading (TextSeg uses a direct URL).
  if (env.OCR_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.OCR_MODEL_REPO, dir: env.OCR_MODELS_DIR, files: env.OCR_MODEL_FILES, label: "OCR" })
      .catch((err: Error) => console.error(`[Boot] OCR download failed — ${err.message}`));
  }
  if (env.TRANSLATE_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.TRANSLATE_MODEL_REPO, dir: env.TRANSLATE_MODELS_DIR, files: env.TRANSLATE_MODEL_FILES, label: "Translate" })
      .catch((err: Error) => console.error(`[Boot] Translate download failed — ${err.message}`));
  }
  if (env.INPAINT_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.INPAINT_MODEL_REPO, dir: env.INPAINT_MODELS_DIR, files: env.INPAINT_MODEL_FILES, label: "Inpaint" })
      .catch((err: Error) => console.error(`[Boot] Inpaint download failed — ${err.message}`));
  }
  if (env.BUBBLE_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.BUBBLE_MODEL_REPO, dir: env.BUBBLE_MODELS_DIR, files: env.BUBBLE_MODEL_FILES, label: "Bubble" })
      .catch((err: Error) => console.error(`[Boot] Bubble download failed — ${err.message}`));
  }
  if (env.TEXT_SEG_MODEL_ENABLED) {
    const textSegUrl = Bun.env.TEXT_SEG_MODEL_URL
      ?? "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx";
    const { join, basename } = await import("node:path");
    const dest = join(env.TEXT_SEG_MODELS_DIR, basename(env.TEXT_SEG_MODEL_FILES[0]));
    await downloadFile(textSegUrl, dest, `TextSeg/${basename(env.TEXT_SEG_MODEL_FILES[0])}`)
      .catch((err: Error) => console.error(`[Boot] TextSeg download failed — ${err.message}`));
  }

  const loadErrors: string[] = [];

  if (env.OCR_MODEL_ENABLED) {
    const { loadOcrModel } = await import("@/services/ocr-service");
    await loadOcrModel().catch((err: Error) => { loadErrors.push(`OCR: ${err.message}`); });
  }
  if (env.TRANSLATE_MODEL_ENABLED) {
    const { loadTranslateModel } = await import("@/services/translate-service");
    await loadTranslateModel().catch((err: Error) => { loadErrors.push(`Translate: ${err.message}`); });
  }
  if (env.TEXT_SEG_MODEL_ENABLED) {
    const { loadTextSegModel } = await import("@/services/text-seg-service");
    await loadTextSegModel().catch((err: Error) => { loadErrors.push(`TextSeg: ${err.message}`); });
  }

  if (loadErrors.length > 0) {
    for (const e of loadErrors) console.error(`Model load failed — ${e}`);
    // bootState.isReady stays false; /health will report "starting" until process restarts
    return;
  }

  bootState.isReady = true;
  console.log("Boot complete — server ready.");
}

// Run migrations before accepting any requests
await migrateDb();

const app = new Elysia()
  .use(cors())
  .use(routeHealth)
  .use(routeOcr)
  .use(routeTranslate)
  .use(routeSettings)
  .use(routeTranslatePage)
  .use(portalPlugin)
  .use(routeSpa);

const listen = env.SOCKET_PATH
  ? { unix: env.SOCKET_PATH }
  : { port: env.PORT };

app.listen(listen, ({ hostname, port }) => {
  console.log(`web-ocr-bun listening on http://${hostname}:${port}`);
});

// Load models non-blocking — server accepts requests immediately, /health returns "starting" until ready
loadModels().catch((err) => {
  console.error("Model loading failed:", err);
  process.exit(1);
});

export type App = typeof app;
