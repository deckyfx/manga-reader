import type {
  Settings,
  SelectionRect,
  FromContentMsg,
  ToContentMsg,
  TokenInfo,
  JishoEntry,
  PopupModeMsg,
  FetchImageMsg,
  ImageUpdatedRelayMsg,
  ImageUpdatedMsg,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, usableApiKey } from "./settings-store";
import { errorMessage, serverApi } from "./api";
import { clearImport, createSeriesFromPage, currentImport, resumeChapterImport, retryChapterImport, startChapterImport } from "./import-queue";
import { ensureContentScript } from "./inject";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenus();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
});

// ── Context menu: the popup's actions, one right-click away ───────────────────

const MENU = { region: "socr-region", image: "socr-image", importChapter: "socr-import" } as const;

/**
 * The same three things the toolbar popup offers. Registered on install and update: MV3 keeps menus across worker
 * restarts and browser restarts, so creating them anywhere else would only duplicate them. Offered on images too,
 * since on a manga reader the page *is* an image and that is where the right-click lands.
 */
function createContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    const contexts: [`${chrome.contextMenus.ContextType}`, ...`${chrome.contextMenus.ContextType}`[]] = ["page", "frame", "selection", "link", "image"];
    chrome.contextMenus.create({ id: MENU.region, title: "Region scan", contexts });
    chrome.contextMenus.create({ id: MENU.image, title: "Translate image", contexts });
    chrome.contextMenus.create({ id: "socr-separator", type: "separator", contexts });
    chrome.contextMenus.create({ id: MENU.importChapter, title: "Import chapter…", contexts });
  });
}

/**
 * The import panel in a window of its own, for when the popup can't be opened from here: an older Chrome, or one that
 * doesn't count a menu click as the gesture openPopup wants. The panel is told which tab to read, since in its own
 * window "the active tab" would be itself.
 */
function openImportWindow(tabId: number | undefined): void {
  if (tabId === undefined) return;
  void chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?tab=${tabId}`),
    type: "popup",
    width: 360,
    height: 600,
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU.importChapter) {
    // First, and synchronously: a menu click counts as a user gesture only until something is awaited, and
    // openPopup may need one. Anything that goes wrong falls back to a window that always works.
    if (typeof chrome.action.openPopup === "function") chrome.action.openPopup().catch(() => openImportWindow(tab?.id));
    else openImportWindow(tab?.id);
    return;
  }
  if (info.menuItemId === MENU.region) void handlePopupMode("region", tab?.id);
  else if (info.menuItemId === MENU.image) void handlePopupMode("image", tab?.id);
});

// An MV3 worker is stopped whenever it looks idle, including mid-import: whatever was left is picked up here, both
// when the browser starts and whenever this worker wakes for any other reason
chrome.runtime.onStartup.addListener(() => void resumeChapterImport());
void resumeChapterImport();

// ── Popup mode handler ────────────────────────────────────────────────────────

async function handlePopupMode(mode: "region" | "image", knownTabId?: number): Promise<void> {
  // The context menu knows which tab it was opened on; the popup's buttons mean the active one
  const tabId = knownTabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId === undefined) return;

  const settings = await loadSettings();

  // Image mode always requires a server URL regardless of engine setting
  if ((settings.ocrEngine === "server" || mode === "image") && !settings.serverUrl) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    return;
  }

  try {
    await ensureContentScript(tabId);

    if (mode === "region") {
      sendToTab(tabId, { type: "start-selection" } satisfies ToContentMsg);
    } else {
      sendToTab(tabId, { type: "start-image-mode" } satisfies ToContentMsg);
    }
  } catch (e) {
    console.error("OCR: failed to inject content script:", e);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((
  msg: FromContentMsg,
  sender,
  sendResponse: (response: unknown) => void,
) => {
  // The chapter-import messages all answer, so they keep the channel open the same way fetch-image does
  if (msg.type === "start-chapter-import") {
    startChapterImport(msg.request)
      .then((job) => sendResponse({ ok: true, job }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  if (msg.type === "create-series") {
    createSeriesFromPage(msg.request)
      .then((series) => sendResponse({ ok: true, series }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  if (msg.type === "import-status") {
    currentImport().then((status) => sendResponse(status)).catch(() => sendResponse(null));
    return true;
  }
  if (msg.type === "retry-import") {
    retryChapterImport()
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
  if (msg.type === "clear-import") {
    clearImport()
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  // fetch-image must return true to keep the message channel open for the async response
  if ((msg as FetchImageMsg).type === "fetch-image") {
    const { url } = msg as FetchImageMsg;
    fetchImageAsBase64(url).then(sendResponse).catch((e: unknown) => {
      sendResponse({ error: String(e) });
    });
    return true;
  }

  const tabId = sender.tab?.id;
  if ((msg as PopupModeMsg).type === "popup-mode") {
    void handlePopupMode((msg as PopupModeMsg).mode);
  } else if (msg.type === "selection-complete" && tabId !== undefined) {
    void handleSelection(msg.rect, tabId);
  } else if (msg.type === "ocr-local-done" && tabId !== undefined) {
    void handleLocalDone(msg.requestId, msg.text, msg.elapsed_ms, tabId);
  } else if (msg.type === "explain-request" && tabId !== undefined) {
    void handleExplain(msg.text, tabId);
  } else if ((msg as ImageUpdatedRelayMsg).type === "image-updated-relay") {
    void handleImageUpdated(msg as unknown as ImageUpdatedRelayMsg);
  }
  return false;
});

// ── Selection → route by engine ───────────────────────────────────────────────

async function handleSelection(rect: SelectionRect, tabId: number): Promise<void> {
  const settings = await loadSettings();

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  } catch (e) {
    sendToTab(tabId, { type: "ocr-error", message: `Screenshot failed: ${errMsg(e)}` });
    return;
  }

  const croppedB64 = await cropToBase64(dataUrl, rect);

  if (settings.ocrEngine === "tesseract") {
    await runTesseractFlow(croppedB64, settings, tabId);
  } else {
    await runServerFlow(croppedB64, settings, tabId);
  }
}

// ── Tesseract flow ────────────────────────────────────────────────────────────

async function runTesseractFlow(
  imageB64: string,
  settings: Settings,
  tabId: number,
): Promise<void> {
  const requestId = crypto.randomUUID();

  sendToTab(tabId, {
    type: "start-ocr-local",
    image: imageB64,
    lang: settings.tesseractLang,
    quality: settings.tesseractQuality,
    requestId,
  } satisfies ToContentMsg);
  // Result comes back via "ocr-local-done" message from content script
}

// ── Handle Tesseract result + optional client-side translation ────────────────

async function handleLocalDone(
  _requestId: string,
  text: string,
  elapsed_ms: number,
  tabId: number,
): Promise<void> {
  const settings = await loadSettings();

  // Translating is the server's job, engine and all; without one there is nothing to ask
  let translation: string | null = null;
  if (text.trim() && settings.translate && settings.serverUrl) {
    const { data, error } = await serverApi(settings.serverUrl, usableApiKey(settings))
      .translate.post({ text })
      .catch((e: unknown) => ({ data: null, error: e }));
    if (error) console.warn("Translation failed:", error);
    translation = data?.translation ?? null;
  }

  sendToTab(tabId, { type: "ocr-result", text, translation, elapsed_ms } satisfies ToContentMsg);
}

// ── Server flow ───────────────────────────────────────────────────────────────

async function runServerFlow(
  imageB64: string,
  settings: Settings,
  tabId: number,
): Promise<void> {
  if (!settings.serverUrl) {
    sendToTab(tabId, { type: "ocr-error", message: "No server URL configured. Open settings." });
    return;
  }

  const start = Date.now();

  try {
    const { data, error } = await serverApi(settings.serverUrl, usableApiKey(settings)).ocr.post({
      image: `data:image/jpeg;base64,${imageB64}`,
      translate: settings.translate,
    });

    if (error) {
      sendToTab(tabId, { type: "ocr-error", message: errorMessage(error) });
      return;
    }

    sendToTab(tabId, {
      type: "ocr-result",
      text: data.text,
      translation: data.translation,
      elapsed_ms: Date.now() - start,
    } satisfies ToContentMsg);
  } catch (e) {
    sendToTab(tabId, { type: "ocr-error", message: errMsg(e) });
  }
}

// ── Explain flow (server-only) ────────────────────────────────────────────────

async function handleExplain(text: string, tabId: number): Promise<void> {
  const settings = await loadSettings();
  if (!settings.serverUrl) {
    sendToTab(tabId, { type: "explain-error", message: "Explain requires a configured server." });
    return;
  }

  try {
    const { data, error } = await serverApi(settings.serverUrl, usableApiKey(settings)).analyze.post({ text, sanitize: true, mode: settings.dictMode });

    if (error) {
      sendToTab(tabId, { type: "explain-error", message: errorMessage(error) });
      return;
    }

    sendToTab(tabId, {
      type: "explain-result",
      tokens: data.tokens,
      definitions: data.definitions,
      mode: settings.dictMode,
    } satisfies ToContentMsg);
  } catch (e) {
    sendToTab(tabId, { type: "explain-error", message: errMsg(e) });
  }
}

// ── Image updated broadcast ────────────────────────────────────────────────────

/**
 * Broadcast an image-updated notification to all tabs that have the content
 * script loaded. Called when the Studio page emits a manga-reader:image-updated
 * postMessage after burning text in Stage 3.
 */
async function handleImageUpdated(relay: ImageUpdatedRelayMsg): Promise<void> {
  const msg: ImageUpdatedMsg = {
    type: "image-updated",
    jobId: relay.jobId,
    resultUrl: relay.resultUrl,
  };
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((t) => t.id !== undefined)
      .map((t) => chrome.tabs.sendMessage(t.id!, msg).catch(() => { /* tab may not have content script */ }))
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FETCH_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const FETCH_IMAGE_TIMEOUT_MS = 15_000;

async function fetchImageAsBase64(url: string): Promise<{ base64: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return { error: `Unexpected content type: ${ct}` };
    const blob = await res.blob();
    if (blob.size > FETCH_IMAGE_MAX_BYTES) return { error: "Image too large (>10 MB)" };
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { base64: btoa(binary) };
  } catch (e) {
    clearTimeout(timer);
    return { error: String(e) };
  }
}

function sendToTab(tabId: number, msg: ToContentMsg): void {
  chrome.tabs.sendMessage(tabId, msg).catch(console.error);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}



async function cropToBase64(dataUrl: string, rect: SelectionRect): Promise<string> {
  const comma = dataUrl.indexOf(",");
  const binaryStr = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const blob = new Blob([bytes], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);

  const sx = Math.round(rect.x * rect.dpr);
  const sy = Math.round(rect.y * rect.dpr);
  const sw = Math.max(1, Math.round(rect.w * rect.dpr));
  const sh = Math.max(1, Math.round(rect.h * rect.dpr));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D context");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  const buf = await outBlob.arrayBuffer();
  const outBytes = new Uint8Array(buf);

  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < outBytes.byteLength; i += chunk) {
    binary += String.fromCharCode(...outBytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
