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
/** A step of a page read as it happens, so the popup can show "reading page 37 of 120" instead of waiting silently. */
export interface ExtractProgressMsg { type: "extract-progress"; message: string }
/** Asks the content script to read this page's chapter images; `rescan` forces the scroll pass. */
export interface ExtractChapterMsg  { type: "extract-chapter"; rescan?: boolean }
/** Asks the content script what this page says about itself, for "New series from this page". */
export interface ExtractSeriesMsg   { type: "extract-series" }
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
  | ExtractChapterMsg
  | ExtractSeriesMsg
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

/** What the popup hands over to start a chapter import: the extractor's find, plus what the user chose to do with it. */
export interface ImportRequest {
  sourceUrl: string;
  provider: string;
  minIntervalMs: number;
  images: string[];
  /** Workspace name, from the page title and chapter number unless the user edited it. */
  name: string;
  adult?: boolean;
  /** Add to this workspace instead of making one (offered for an earlier import of the same address). */
  workspaceId?: number;
  /** Start "Run all" once every page is in. */
  runAfter: boolean;
}

/** What the popup hands over to make a series: what the page said, as the user left it. */
export interface CreateSeriesRequest {
  title: string;
  synopsis?: string;
  /** Address of the cover to fetch and upload; the worker does both, as it does for chapter images. */
  cover?: string;
  adult: boolean;
}

export interface CreateSeriesMsg       { type: "create-series"; request: CreateSeriesRequest }

export interface StartChapterImportMsg { type: "start-chapter-import"; request: ImportRequest }
export interface ImportStatusMsg       { type: "import-status" }
/** Forgets a finished import so the popup offers a fresh one. */
export interface ClearImportMsg        { type: "clear-import" }
/** Carries on an import that stopped on an error (the server went away, the network dropped). */
export interface RetryImportMsg        { type: "retry-import" }
export interface FetchImageMsg        { type: "fetch-image"; url: string }

export type FromContentMsg =
  | SelectionCompleteMsg
  | OcrLocalDoneMsg
  | ExplainRequestMsg
  | ImageUpdatedRelayMsg
  | PopupModeMsg
  | FetchImageMsg
  | StartChapterImportMsg
  | CreateSeriesMsg
  | ImportStatusMsg
  | ClearImportMsg
  | RetryImportMsg;

// ── Messages: engine iframe ↔ content (window.postMessage) ───────────────────

export interface EngineReadyMsg      { type: "engine-ready" }
export interface EngineOcrRequestMsg { type: "ocr-request"; requestId: string; image: string; lang: string; quality: string }
export interface EngineProgressMsg   { type: "ocr-progress"; requestId: string; status: string; progress: number }
export interface EngineResultMsg     { type: "ocr-result";   requestId: string; text: string }
export interface EngineErrorMsg      { type: "ocr-error";    requestId: string; message: string }

export type ToEngineMsg   = EngineOcrRequestMsg;
export type FromEngineMsg = EngineReadyMsg | EngineProgressMsg | EngineResultMsg | EngineErrorMsg;
