/** Type-safe singleton for all environment configuration. */
class EnvConfig {
  private static instance: EnvConfig;

  private constructor() {}

  static getInstance(): EnvConfig {
    if (!EnvConfig.instance) EnvConfig.instance = new EnvConfig();
    return EnvConfig.instance;
  }

  // ── Server ──────────────────────────────────────────────────────────────

  get PORT(): number {
    return parseInt(Bun.env.PORT ?? "3579", 10);
  }

  get NODE_ENV(): "development" | "production" | "test" {
    return (Bun.env.NODE_ENV ?? "development") as "development" | "production" | "test";
  }

  get isDev(): boolean { return this.NODE_ENV === "development"; }
  get isProd(): boolean { return this.NODE_ENV === "production"; }

  /** Unix socket path — when set the server binds here instead of TCP. */
  get SOCKET_PATH(): string | undefined { return Bun.env.SOCKET_PATH || undefined; }

  // ── Database ─────────────────────────────────────────────────────────────

  get DATABASE_URL(): string {
    return Bun.env.DATABASE_URL ?? "./data/ocr.db";
  }

  // ── Model directories ────────────────────────────────────────────────────

  get OCR_MODELS_DIR(): string { return Bun.env.OCR_MODELS_DIR ?? "./data/models/ocr"; }
  get TRANSLATE_MODELS_DIR(): string { return Bun.env.TRANSLATE_MODELS_DIR ?? "./data/models/translate"; }
  get INPAINT_MODELS_DIR(): string { return Bun.env.INPAINT_MODELS_DIR ?? "./data/models/inpaint"; }
  get BUBBLE_MODELS_DIR(): string { return Bun.env.BUBBLE_MODELS_DIR ?? "./data/models/bubble"; }
  get TEXT_SEG_MODELS_DIR(): string { return Bun.env.TEXT_SEG_MODELS_DIR ?? "./data/models/textseg"; }
  get DICT_DIR(): string { return Bun.env.DICT_DIR ?? "./data/models/jdict"; }
  /** Override the auto-resolved Jitendex GitHub release URL. */
  get JITENDEX_ZIP_URL(): string | undefined { return Bun.env.JITENDEX_ZIP_URL || undefined; }
  get DICT_MODEL_ENABLED(): boolean { return Bun.env.DICT_MODEL_ENABLED !== "false"; }

  // ── Model repos ──────────────────────────────────────────────────────────

  get OCR_MODEL_REPO(): string { return Bun.env.OCR_MODEL_REPO ?? "mayocream/manga-ocr-onnx"; }
  get OCR_MODEL_ENABLED(): boolean { return Bun.env.OCR_MODEL_ENABLED !== "false"; }
  get OCR_MODEL_FILES(): string[] {
    return (Bun.env.OCR_MODEL_FILES ?? "encoder_model.onnx,decoder_model.onnx,vocab.txt").split(",");
  }

  get TRANSLATE_MODEL_REPO(): string { return Bun.env.TRANSLATE_MODEL_REPO ?? "Xenova/opus-mt-ja-en"; }
  get TRANSLATE_MODEL_ENABLED(): boolean { return Bun.env.TRANSLATE_MODEL_ENABLED !== "false"; }
  get TRANSLATE_MODEL_FILES(): string[] {
    return (Bun.env.TRANSLATE_MODEL_FILES ?? "onnx/encoder_model.onnx,onnx/decoder_model.onnx,tokenizer.json").split(",");
  }

  get INPAINT_MODEL_REPO(): string { return Bun.env.INPAINT_MODEL_REPO ?? "Carve/LaMa-ONNX"; }
  get INPAINT_MODEL_ENABLED(): boolean { return Bun.env.INPAINT_MODEL_ENABLED === "true"; }
  get INPAINT_MODEL_FILES(): string[] {
    return (Bun.env.INPAINT_MODEL_FILES ?? "lama_fp32.onnx").split(",");
  }

  get BUBBLE_MODEL_REPO(): string { return Bun.env.BUBBLE_MODEL_REPO ?? "ogkalu/comic-text-and-bubble-detector"; }
  get BUBBLE_MODEL_ENABLED(): boolean { return Bun.env.BUBBLE_MODEL_ENABLED === "true"; }
  get BUBBLE_MODEL_FILES(): string[] {
    return (Bun.env.BUBBLE_MODEL_FILES ?? "detector-v4-s_int8.onnx").split(",");
  }

  get TEXT_SEG_MODEL_REPO(): string { return Bun.env.TEXT_SEG_MODEL_REPO ?? "zyddnys/manga-image-translator"; }
  get TEXT_SEG_MODEL_ENABLED(): boolean { return Bun.env.TEXT_SEG_MODEL_ENABLED === "true"; }
  get TEXT_SEG_MODEL_FILES(): string[] {
    return (Bun.env.TEXT_SEG_MODEL_FILES ?? "comictextdetector.pt.onnx").split(",");
  }

  // ── Debug ────────────────────────────────────────────────────────────────

  /** When true, saves each OCR input image to ./data/debug/ocr/ for inspection. */
  get OCR_DEBUG(): boolean { return Bun.env.OCR_DEBUG === "true"; }

  // ── API keys / engines ───────────────────────────────────────────────────

  get DEEPL_API_KEY(): string | undefined { return Bun.env.DEEPL_API_KEY || undefined; }

  get PREFERRED_TRANSLATION_ENGINE(): "auto" | "local" | "deepl" {
    const v = Bun.env.PREFERRED_TRANSLATION_ENGINE ?? "auto";
    return (["auto", "local", "deepl"].includes(v) ? v : "auto") as "auto" | "local" | "deepl";
  }

  get INPAINT_ENGINE(): "auto" | "lama" | "flood_fill" {
    const v = Bun.env.INPAINT_ENGINE ?? "auto";
    return (["auto", "lama", "flood_fill"].includes(v) ? v : "auto") as "auto" | "lama" | "flood_fill";
  }
}

export const env = EnvConfig.getInstance();
