// ── Engine / settings types ───────────────────────────────────────────────────

export type OcrEngine         = "tesseract" | "server";
export type ServerTranslation = "none" | "auto" | "local" | "deepl";
export type ClientTranslation = "none" | "deepl";
export type DictMode          = "local" | "jisho";
export type TesseractQuality  = "4.0.0" | "4.0.0_best";

export interface Settings {
  // Which OCR engine to use
  ocrEngine: OcrEngine;

  // Server-mode settings
  serverUrl: string;
  /** The server refuses OCR, translation and page jobs without one; make it on the server's /user page. */
  serverApiKey: string;
  /**
   * Send the key to a plain-http address that isn't loopback. Off by default, because anyone on that network can
   * read the key out of the request — on by choice, because a self-hosted server on a home LAN is exactly the case
   * this extension exists for.
   */
  allowInsecureServer: boolean;
  serverTranslation: ServerTranslation;
  dictMode: DictMode;
  /** Page translation also removes sound effects (can soften detailed artwork). */
  pageCleanSfx: boolean;

  // Tesseract-mode settings
  tesseractLang: string;
  tesseractQuality: TesseractQuality;

  // Client-side translation (Tesseract mode; optionally server mode too)
  clientTranslation: ClientTranslation;
  deeplApiKey: string;
  deeplTargetLang: string;
}

export const DEFAULT_SETTINGS: Settings = {
  ocrEngine: "tesseract",
  serverUrl: "",
  serverApiKey: "",
  allowInsecureServer: false,
  serverTranslation: "auto",
  dictMode: "jisho",
  pageCleanSfx: false,
  tesseractLang: "jpn",
  tesseractQuality: "4.0.0",
  clientTranslation: "none",
  deeplApiKey: "",
  deeplTargetLang: "EN-US",
};

// ── Token / dictionary types ──────────────────────────────────────────────────

export interface TokenInfo {
  surface: string;
  dictionary_form: string;
  reading: string;
  pos: string;
  pos_detail: string;
  conjugation_type: string;
  conjugation_form: string;
  is_unknown: boolean;
}

export interface JishoEntry {
  word: string;
  reading: string;
  romaji: string;
  meanings: string[];
  jlpt: string | null;
  is_common: boolean;
}

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
}

// ── Messages: background → content ───────────────────────────────────────────

export interface StartSelectionMsg  { type: "start-selection" }
/** Background has cropped the image; content should run Tesseract in the engine iframe */
export interface StartOcrLocalMsg   { type: "start-ocr-local"; image: string; lang: string; quality: string; requestId: string }
export interface OcrResultMsg       { type: "ocr-result"; text: string; translation: string | null; elapsed_ms: number }
export interface OcrErrorMsg        { type: "ocr-error"; message: string }
export interface ExplainResultMsg   { type: "explain-result"; tokens: TokenInfo[]; definitions: (JishoEntry | null)[]; mode: "local" | "jisho" }
export interface ExplainErrorMsg    { type: "explain-error"; message: string }

export interface StartImageModeMsg  { type: "start-image-mode" }
/** Sent to content tabs when Studio burns text and the result image is updated. */
export interface ImageUpdatedMsg    { type: "image-updated"; jobId: string; resultUrl: string }

export type ToContentMsg =
  | StartSelectionMsg
  | StartOcrLocalMsg
  | OcrResultMsg
  | OcrErrorMsg
  | ExplainResultMsg
  | ExplainErrorMsg
  | StartImageModeMsg
  | ImageUpdatedMsg;

// ── Messages: content → background ───────────────────────────────────────────

export interface SelectionCompleteMsg  { type: "selection-complete"; rect: SelectionRect }
/** Tesseract finished; background should do translation and send ocr-result back */
export interface OcrLocalDoneMsg       { type: "ocr-local-done"; requestId: string; text: string; elapsed_ms: number }
export interface ExplainRequestMsg     { type: "explain-request"; text: string }
/** Relays a web-ocr:image-updated postMessage from the Studio page to background. */
export interface ImageUpdatedRelayMsg  { type: "image-updated-relay"; jobId: string; resultUrl: string }

// ── Messages: popup → background ─────────────────────────────────────────────

export interface PopupModeMsg         { type: "popup-mode"; mode: "region" | "image" }
export interface FetchImageMsg        { type: "fetch-image"; url: string }

export type FromContentMsg =
  | SelectionCompleteMsg
  | OcrLocalDoneMsg
  | ExplainRequestMsg
  | ImageUpdatedRelayMsg
  | PopupModeMsg
  | FetchImageMsg;

// ── Messages: engine iframe ↔ content (window.postMessage) ───────────────────

export interface EngineReadyMsg      { type: "engine-ready" }
export interface EngineOcrRequestMsg { type: "ocr-request"; requestId: string; image: string; lang: string; quality: string }
export interface EngineProgressMsg   { type: "ocr-progress"; requestId: string; status: string; progress: number }
export interface EngineResultMsg     { type: "ocr-result";   requestId: string; text: string }
export interface EngineErrorMsg      { type: "ocr-error";    requestId: string; message: string }

export type ToEngineMsg   = EngineOcrRequestMsg;
export type FromEngineMsg = EngineReadyMsg | EngineProgressMsg | EngineResultMsg | EngineErrorMsg;
