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

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
});

// ── Popup mode handler ────────────────────────────────────────────────────────

async function handlePopupMode(mode: "region" | "image"): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const tabId = tab.id;

  const settings = await loadSettings();

  // Image mode always requires a server URL regardless of engine setting
  if ((settings.ocrEngine === "server" || mode === "image") && !settings.serverUrl) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    return;
  }

  try {
    const checkResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean((window as unknown as Record<string, unknown>)["__socrLoaded"]),
    });

    if (!checkResult[0]?.result) {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await sleep(40);
    }

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

  let translation: string | null = null;
  if (text.trim() && settings.clientTranslation === "deepl" && settings.deeplApiKey) {
    translation = await translateDeepL(text, settings.deeplTargetLang, settings.deeplApiKey)
      .catch((e) => {
        console.warn("DeepL translation failed:", e);
        return null;
      });
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
      translate_engine: settings.serverTranslation,
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
 * script loaded. Called when the Studio page emits a web-ocr:image-updated
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

// ── DeepL client-side translation ─────────────────────────────────────────────

async function translateDeepL(
  text: string,
  targetLang: string,
  apiKey: string,
): Promise<string> {
  // Free-tier keys end with ":fx"; pro keys don't
  const baseUrl = apiKey.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";

  const res = await fetch(`${baseUrl}/v2/translate`, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: [text], target_lang: targetLang }),
  });

  if (!res.ok) throw new Error(`DeepL ${res.status}`);
  const data = await res.json() as { translations: { text: string }[] };
  return data.translations[0]?.text ?? "";
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
