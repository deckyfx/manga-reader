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

  /**
   * Interface the TCP listener binds to. Loopback by default. `HOST=0.0.0.0` opens it to other devices. Plain http is
   * for development only (passwords and session cookies cross the network in clear); a real deployment reachable
   * beyond this machine needs TLS in front, with `TRUST_PROXY` set.
   */
  get HOST(): string {
    return Bun.env.HOST ?? "127.0.0.1";
  }

  /**
   * The reverse proxies (that terminate TLS) whose `X-Forwarded-Proto` and `X-Forwarded-For` are believed: `true` for
   * one on this machine (loopback), or a comma-separated list of their addresses. The headers are ignored from anyone
   * else, since any client could send them. Unset: ignored from everyone.
   */
  get TRUSTED_PROXIES(): string[] {
    const raw = (Bun.env.TRUST_PROXY ?? "").trim();
    if (raw === "" || raw === "false") return [];
    if (raw === "true") return ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
    return raw.split(",").map((address) => address.trim()).filter(Boolean);
  }

  get NODE_ENV(): "development" | "production" | "test" {
    return (Bun.env.NODE_ENV ?? "development") as "development" | "production" | "test";
  }

  get isDev(): boolean { return this.NODE_ENV === "development"; }
  get isProd(): boolean { return this.NODE_ENV === "production"; }

  // ── Secrets at rest ──────────────────────────────────────────────────────

  /** 32 bytes of base64 that seal TOTP secrets. Left unset, a key file is made beside the database. */
  get SECRET_KEY(): string | undefined {
    return Bun.env.SECRET_KEY || undefined;
  }

  /** Where that key is kept when SECRET_KEY isn't set. Back it up with the database. */
  get SECRET_KEY_FILE(): string {
    return Bun.env.SECRET_KEY_FILE ?? "./data/secret.key";
  }

  // ── Passkeys ─────────────────────────────────────────────────────────────

  /**
   * The domain passkeys are bound to. A passkey made on one origin can't be used on another, and the browser only
   * offers WebAuthn on a secure context — `http://localhost` counts, a plain-http LAN address does not.
   */
  get WEBAUTHN_RP_ID(): string {
    return Bun.env.WEBAUTHN_RP_ID ?? "localhost";
  }

  get WEBAUTHN_RP_NAME(): string {
    return Bun.env.WEBAUTHN_RP_NAME ?? "web-ocr";
  }

  /** Where the browser thinks it is; must match exactly, scheme and port included. */
  get WEBAUTHN_ORIGIN(): string {
    return Bun.env.WEBAUTHN_ORIGIN ?? `http://localhost:${this.PORT}`;
  }

  /** Unix socket path — when set the server binds here instead of TCP. */
  get SOCKET_PATH(): string | undefined { return Bun.env.SOCKET_PATH || undefined; }

  // ── Database ─────────────────────────────────────────────────────────────

  get DATABASE_URL(): string {
    return Bun.env.DATABASE_URL ?? "./data/ocr.db";
  }

  // ── Model directories ────────────────────────────────────────────────────

  get OCR_MODELS_DIR(): string {
    return Bun.env.OCR_MODELS_DIR ?? (this.OCR_ENGINE === "baberu" ? "./data/models/baberu" : "./data/models/ocr");
  }
  get TRANSLATE_MODELS_DIR(): string { return Bun.env.TRANSLATE_MODELS_DIR ?? "./data/models/translate"; }
  get INPAINT_MODELS_DIR(): string { return Bun.env.INPAINT_MODELS_DIR ?? "./data/models/inpaint"; }
  get BUBBLE_MODELS_DIR(): string { return Bun.env.BUBBLE_MODELS_DIR ?? "./data/models/bubble"; }
  get TEXT_SEG_MODELS_DIR(): string { return Bun.env.TEXT_SEG_MODELS_DIR ?? "./data/models/textseg"; }
  get DICT_DIR(): string { return Bun.env.DICT_DIR ?? "./data/models/jdict"; }
  /** Official jitendex.org download link — always redirects to the newest build. */
  get JITENDEX_ZIP_URL(): string {
    return Bun.env.JITENDEX_ZIP_URL
      || "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip";
  }
  get DICT_MODEL_ENABLED(): boolean { return Bun.env.DICT_MODEL_ENABLED !== "false"; }
  /** kuromoji IPADIC tokenizer dictionary (used by /analyze). */
  get KUROMOJI_DICT_DIR(): string { return Bun.env.KUROMOJI_DICT_DIR ?? "./data/models/kuromoji"; }
  /** Base URL serving the kuromoji *.dat.gz files; pinned to the installed @patdx/kuromoji version. */
  get KUROMOJI_DICT_URL(): string {
    return Bun.env.KUROMOJI_DICT_URL || "https://cdn.jsdelivr.net/npm/@patdx/kuromoji@1.0.4/dict";
  }

  // ── Model repos ──────────────────────────────────────────────────────────

  /** "baberu" (default; Japanese/Chinese/English) or "manga-ocr" (Japanese only). Sets the OCR repo/dir/files defaults. */
  get OCR_ENGINE(): "baberu" | "manga-ocr" { return Bun.env.OCR_ENGINE === "manga-ocr" ? "manga-ocr" : "baberu"; }
  get OCR_MODEL_REPO(): string {
    return Bun.env.OCR_MODEL_REPO ?? (this.OCR_ENGINE === "baberu" ? "genshiai-daichi/baberu-ocr" : "mayocream/manga-ocr-onnx");
  }
  get OCR_MODEL_ENABLED(): boolean { return Bun.env.OCR_MODEL_ENABLED !== "false"; }
  get OCR_MODEL_FILES(): string[] {
    const defaults = this.OCR_ENGINE === "baberu"
      ? "onnx/vision_int4.onnx,onnx/decoder_prefill_int8.onnx,onnx/decoder_step_int8.onnx,tokenizer/vocab.json"
      : "encoder_model.onnx,decoder_model.onnx,vocab.txt";
    return (Bun.env.OCR_MODEL_FILES ?? defaults).split(",");
  }

  get TRANSLATE_MODEL_REPO(): string { return Bun.env.TRANSLATE_MODEL_REPO ?? "Xenova/opus-mt-ja-en"; }
  get TRANSLATE_MODEL_ENABLED(): boolean { return Bun.env.TRANSLATE_MODEL_ENABLED !== "false"; }
  get TRANSLATE_MODEL_FILES(): string[] {
    return (Bun.env.TRANSLATE_MODEL_FILES ?? "onnx/encoder_model.onnx,onnx/decoder_model.onnx,tokenizer.json").split(",");
  }

  /** Manga-finetuned LaMa with dynamic input size (generic Carve/LaMa-ONNX leaves blocks on manga). */
  get INPAINT_MODEL_REPO(): string { return Bun.env.INPAINT_MODEL_REPO ?? "ogkalu/lama-manga-onnx-dynamic"; }
  get INPAINT_MODEL_ENABLED(): boolean { return Bun.env.INPAINT_MODEL_ENABLED === "true"; }
  get INPAINT_MODEL_FILES(): string[] {
    return (Bun.env.INPAINT_MODEL_FILES ?? "lama-manga-dynamic.onnx").split(",");
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
