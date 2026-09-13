import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "@/env";
import { bootState } from "@/boot-state";
import { logger, childLogger } from "@/lib/logger";
import { loggerPlugin } from "@/plugins/plugin-logger";
import { api } from "@/api";
import { routeSettings } from "@/plugins/route-settings";
import { portalPlugin } from "@/plugins/portal/index";
import { routeSpa } from "@/plugins/route-spa";

const bootLog = childLogger("boot");

async function migrateDb(): Promise<void> {
  const { MigrationManager } = await import("@/db/migration-manager");
  await MigrationManager.init();
}

async function loadModels(): Promise<void> {
  bootState.inpaintEnabled = env.INPAINT_MODEL_ENABLED;
  bootState.bubbleEnabled = env.BUBBLE_MODEL_ENABLED;
  bootState.textSegEnabled = env.TEXT_SEG_MODEL_ENABLED;

  const { downloadHfModel, downloadFile, printDownloadPlan } = await import("@/services/model-downloader");
  const { KUROMOJI_DICT_FILES } = await import("@/services/analyze-service");

  const entries = [
    env.OCR_MODEL_ENABLED && { repo: env.OCR_MODEL_REPO, dir: env.OCR_MODELS_DIR, files: env.OCR_MODEL_FILES, label: "OCR" },
    env.TRANSLATE_MODEL_ENABLED && { repo: env.TRANSLATE_MODEL_REPO, dir: env.TRANSLATE_MODELS_DIR, files: env.TRANSLATE_MODEL_FILES, label: "Translate" },
    env.INPAINT_MODEL_ENABLED && { repo: env.INPAINT_MODEL_REPO, dir: env.INPAINT_MODELS_DIR, files: env.INPAINT_MODEL_FILES, label: "Inpaint" },
    env.BUBBLE_MODEL_ENABLED && { repo: env.BUBBLE_MODEL_REPO, dir: env.BUBBLE_MODELS_DIR, files: env.BUBBLE_MODEL_FILES, label: "Bubble" },
    env.TEXT_SEG_MODEL_ENABLED && { repo: "", dir: env.TEXT_SEG_MODELS_DIR, files: env.TEXT_SEG_MODEL_FILES, label: "TextSeg" },
  ].filter(Boolean) as { repo: string; dir: string; files: string[]; label: string }[];

  printDownloadPlan(entries);

  if (env.DICT_MODEL_ENABLED) {
    const { join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    if (!existsSync(join(env.DICT_DIR, "jitendex-yomitan.zip"))) {
      bootLog.info("  ↓ Dict/jitendex-yomitan.zip");
    }
    for (const file of KUROMOJI_DICT_FILES) {
      if (!existsSync(join(env.KUROMOJI_DICT_DIR, file))) bootLog.info(`  ↓ Kuromoji/${file}`);
    }
  }

  if (env.OCR_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.OCR_MODEL_REPO, dir: env.OCR_MODELS_DIR, files: env.OCR_MODEL_FILES, label: "OCR" })
      .catch((err: Error) => bootLog.error({ err }, "OCR download failed"));
  }
  if (env.TRANSLATE_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.TRANSLATE_MODEL_REPO, dir: env.TRANSLATE_MODELS_DIR, files: env.TRANSLATE_MODEL_FILES, label: "Translate" })
      .catch((err: Error) => bootLog.error({ err }, "Translate download failed"));
  }
  if (env.INPAINT_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.INPAINT_MODEL_REPO, dir: env.INPAINT_MODELS_DIR, files: env.INPAINT_MODEL_FILES, label: "Inpaint" })
      .catch((err: Error) => bootLog.error({ err }, "Inpaint download failed"));
  }
  if (env.BUBBLE_MODEL_ENABLED) {
    await downloadHfModel({ repo: env.BUBBLE_MODEL_REPO, dir: env.BUBBLE_MODELS_DIR, files: env.BUBBLE_MODEL_FILES, label: "Bubble" })
      .catch((err: Error) => bootLog.error({ err }, "Bubble download failed"));
  }
  if (env.TEXT_SEG_MODEL_ENABLED) {
    const textSegUrl = Bun.env.TEXT_SEG_MODEL_URL
      ?? "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx";
    const { join, basename } = await import("node:path");
    const dest = join(env.TEXT_SEG_MODELS_DIR, basename(env.TEXT_SEG_MODEL_FILES[0]));
    await downloadFile(textSegUrl, dest, `TextSeg/${basename(env.TEXT_SEG_MODEL_FILES[0])}`)
      .catch((err: Error) => bootLog.error({ err }, "TextSeg download failed"));
  }

  if (env.DICT_MODEL_ENABLED) {
    const { join } = await import("node:path");
    const zipDest = join(env.DICT_DIR, "jitendex-yomitan.zip");
    await downloadFile(env.JITENDEX_ZIP_URL, zipDest, "Dict/jitendex-yomitan.zip")
      .catch((err: Error) => bootLog.warn({ err }, "Jitendex download failed — dictionary lookups will be unavailable"));
    try {
      for (const file of KUROMOJI_DICT_FILES) {
        await downloadFile(`${env.KUROMOJI_DICT_URL}/${file}`, join(env.KUROMOJI_DICT_DIR, file), `Kuromoji/${file}`);
      }
    } catch (err) {
      bootLog.warn({ err }, "Kuromoji dictionary download failed — /analyze will be unavailable");
    }
  }

  const loadErrors: string[] = [];

  if (env.OCR_MODEL_ENABLED) {
    const load = env.OCR_ENGINE === "baberu"
      ? (await import("@/services/baberu-ocr-service")).loadBaberuOcrModel
      : (await import("@/services/ocr-service")).loadOcrModel;
    await load().catch((err: Error) => { loadErrors.push(`OCR (${env.OCR_ENGINE}): ${err.message}`); });
  }
  if (env.TRANSLATE_MODEL_ENABLED) {
    const { loadTranslateModel } = await import("@/services/translate-service");
    await loadTranslateModel().catch((err: Error) => { loadErrors.push(`Translate: ${err.message}`); });
  }
  if (env.TEXT_SEG_MODEL_ENABLED) {
    const { loadTextSegModel } = await import("@/services/text-seg-service");
    await loadTextSegModel().catch((err: Error) => { loadErrors.push(`TextSeg: ${err.message}`); });
  }

  if (env.INPAINT_MODEL_ENABLED) {
    const { loadInpaintModel } = await import("@/services/inpaint-service");
    await loadInpaintModel().catch((err: Error) => bootLog.warn({ err }, "Inpaint model unavailable"));
  }

  // Dictionary is non-fatal (health reports "degraded"); /analyze needs both tokenizer and index.
  if (env.DICT_MODEL_ENABLED) {
    const { analyzeService } = await import("@/services/analyze-service");
    const { dictionaryService } = await import("@/services/dictionary-service");
    try {
      await analyzeService.load();
      await dictionaryService.init();
      bootState.dictionaryReady = true;
    } catch (err) {
      bootLog.warn({ err }, "Dictionary unavailable — /analyze will return 503");
    }
  }

  if (loadErrors.length > 0) {
    for (const e of loadErrors) bootLog.error(e);
    return;
  }

  bootState.isReady = true;
  bootLog.info("Boot complete — server ready.");
}

await migrateDb();
await loadModels().catch((err) => {
  logger.fatal({ err }, "Model loading failed — exiting");
  process.exit(1);
});

const app = new Elysia()
  .use(loggerPlugin)
  .use(cors())
  .use(api)
  .use(routeSettings)
  .use(portalPlugin)
  .use(routeSpa);

const listen = env.SOCKET_PATH
  ? { unix: env.SOCKET_PATH }
  : { port: env.PORT };

app.listen(listen, ({ hostname, port }) => {
  logger.info(`web-ocr-bun listening on http://${hostname}:${port}`);
});

// Graceful shutdown — one Ctrl+C is enough
const shutdown = (signal: string) => {
  logger.info(`${signal} — shutting down`);
  app.stop();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export type App = typeof app;
