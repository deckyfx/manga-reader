import type {
  ToContentMsg,
  FromContentMsg,
  SelectionCompleteMsg,
  OcrLocalDoneMsg,
  ExplainRequestMsg,
  TokenInfo,
  JishoEntry,
  OcrResultMsg,
  ImageUpdatedRelayMsg,
  ToEngineMsg,
  FromEngineMsg,
  FetchImageMsg,
} from "./types";
import { loadServerAccess } from "./settings-store";
import { errorMessage, serverApi, streamUrl, type PageJobEvent, type PageLiveEvent } from "./api";

// ── Guard ─────────────────────────────────────────────────────────────────────

type SocrWindow = Window & { __socrLoaded?: boolean };
const _w = window as SocrWindow;
if (!_w.__socrLoaded) {
  _w.__socrLoaded = true;
  init();
}

// ── State ─────────────────────────────────────────────────────────────────────

let selectionRect: { x: number; y: number; w: number; h: number } | null = null;
let resultPanelEl: HTMLElement | null = null;
let overlayEl: HTMLElement | null = null;
let keydownListener: ((e: KeyboardEvent) => void) | null = null;

type ExplainItem = { token: TokenInfo; def: JishoEntry };
let explainItems: ExplainItem[] = [];
let explainPage = 0;
let explainMode: "local" | "jisho" = "jisho";
let lastOcrResult: OcrResultMsg | null = null;
const EXPLAIN_PAGE_SIZE = 3;

// Engine iframe state
let engineFrame: HTMLIFrameElement | null = null;
let engineReady = false;
let pendingEngineRequest: (() => void) | null = null;
let activeRequestId: string | null = null;
let ocrStartTime = 0;

// ── Init ──────────────────────────────────────────────────────────────────────

function init(): void {
  chrome.runtime.onMessage.addListener((msg: ToContentMsg) => {
    if      (msg.type === "start-selection")  startSelection();
    else if (msg.type === "start-image-mode") startImageMode();
    else if (msg.type === "start-ocr-local")  startLocalOcr(msg.image, msg.lang, msg.quality, msg.requestId);
    else if (msg.type === "ocr-result")       showResult(msg);
    else if (msg.type === "ocr-error")        showError(msg.message);
    else if (msg.type === "explain-result")   showExplain(msg.tokens, msg.definitions, msg.mode);
    else if (msg.type === "explain-error")    showExplainError(msg.message);
    else if (msg.type === "image-updated") showRevision(msg.jobId, msg.resultUrl);
  });

  // Studio page → extension bridge: relay image-updated events from the same origin
  window.addEventListener("message", (e: MessageEvent<{ type?: string; jobId?: string; resultUrl?: string }>) => {
    if (e.data?.type === "web-ocr:image-updated" && e.origin === window.location.origin) {
      const relay: ImageUpdatedRelayMsg = {
        type: "image-updated-relay",
        jobId: e.data.jobId ?? "",
        resultUrl: e.data.resultUrl ?? "",
      };
      chrome.runtime.sendMessage(relay as unknown as FromContentMsg).catch(console.error);
    }
  });

  // Engine iframe messages (postMessage from engine.html)
  window.addEventListener("message", (e: MessageEvent<FromEngineMsg>) => {
    if (!e.data?.type) return;
    // Only accept messages from our engine iframe
    if (engineFrame && e.source !== engineFrame.contentWindow) return;

    const msg = e.data;
    if (msg.type === "engine-ready") {
      engineReady = true;
      pendingEngineRequest?.();
      pendingEngineRequest = null;
    } else if (msg.type === "ocr-progress" && msg.requestId === activeRequestId) {
      updateProgress(msg.status, msg.progress);
    } else if (msg.type === "ocr-result" && msg.requestId === activeRequestId) {
      const elapsed = Date.now() - ocrStartTime;
      activeRequestId = null;
      const doneMsg: OcrLocalDoneMsg = {
        type: "ocr-local-done",
        requestId: msg.requestId,
        text: msg.text,
        elapsed_ms: elapsed,
      };
      chrome.runtime.sendMessage(doneMsg as unknown as FromContentMsg).catch(console.error);
      // Panel stays in loading state until background sends back ocr-result (with optional translation)
      updateProgress("Translating…", 1);
    } else if (msg.type === "ocr-error" && msg.requestId === activeRequestId) {
      activeRequestId = null;
      showError(msg.message);
    }
  });
}

// ── Local OCR flow ────────────────────────────────────────────────────────────

function startLocalOcr(image: string, lang: string, quality: string, requestId: string): void {
  activeRequestId = requestId;
  ocrStartTime = Date.now();

  const send = (): void => {
    const req: ToEngineMsg = { type: "ocr-request", requestId, image, lang, quality };
    engineFrame!.contentWindow!.postMessage(req, "*");
  };

  if (engineFrame && engineReady) {
    send();
  } else {
    ensureEngineFrame();
    pendingEngineRequest = send;
  }
}

function ensureEngineFrame(): void {
  if (engineFrame) return;
  engineReady = false;

  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("engine.html");
  frame.style.cssText = "display:none!important;position:fixed!important;width:0!important;height:0!important;border:none!important;";
  frame.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(frame);
  engineFrame = frame;
}

// ── Selection UI ──────────────────────────────────────────────────────────────

function startSelection(): void {
  cleanup();

  const overlay = document.createElement("div");
  overlay.id = "socr-overlay";

  const backdrop = document.createElement("div");
  backdrop.id = "socr-backdrop";

  const hint = document.createElement("div");
  hint.id = "socr-hint";
  hint.textContent = "Click and drag to select a region — Esc to cancel";

  const selBox = document.createElement("div");
  selBox.id = "socr-selection";

  overlay.appendChild(hint);
  overlay.appendChild(selBox);
  document.body.appendChild(backdrop);
  document.body.appendChild(overlay);
  overlayEl = overlay;

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function updateSelBox(x: number, y: number, w: number, h: number): void {
    selBox.style.cssText = `
      display: block !important;
      left: ${x}px !important;
      top: ${y}px !important;
      width: ${w}px !important;
      height: ${h}px !important;
    `;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    hint.style.display = "none";
    backdrop.style.display = "none";
    updateSelBox(startX, startY, 0, 0);
  }

  function onMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    e.preventDefault();
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    updateSelBox(x, y, w, h);
  }

  function onMouseUp(e: MouseEvent): void {
    if (!dragging) return;
    dragging = false;

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    removeOverlay();
    if (w < 8 || h < 8) return;

    selectionRect = { x, y, w, h };
    showLoading(x, y, w, h);

    const msg: SelectionCompleteMsg = {
      type: "selection-complete",
      rect: { x, y, w, h, dpr: window.devicePixelRatio },
    };
    chrome.runtime.sendMessage(msg as unknown as FromContentMsg).catch(console.error);
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cleanup();
  };

  keydownListener = onKeyDown;
  document.addEventListener("keydown", onKeyDown);
  overlay.addEventListener("mousedown", onMouseDown);
  overlay.addEventListener("mousemove", onMouseMove);
  overlay.addEventListener("mouseup", onMouseUp);
}

function removeOverlay(): void {
  if (keydownListener) {
    document.removeEventListener("keydown", keydownListener);
    keydownListener = null;
  }
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  document.getElementById("socr-backdrop")?.remove();
}

// ── Panel factory ─────────────────────────────────────────────────────────────

function createPanel(selX: number, selY: number, selW: number, selH: number): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "socr-result-panel";
  repositionPanel(panel, selX, selY, selW, selH);

  const inner = document.createElement("div");
  inner.className = "socr-panel-inner";
  panel.appendChild(inner);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "socr-resize-handle";
  resizeHandle.setAttribute("aria-hidden", "true");
  panel.appendChild(resizeHandle);

  makeDraggable(panel, inner);
  makeResizable(panel, resizeHandle);
  return panel;
}

function setInnerContent(panel: HTMLElement, html: string): void {
  const inner = panel.querySelector<HTMLElement>(".socr-panel-inner");
  if (inner) inner.innerHTML = html;
}

// ── Loading panel ─────────────────────────────────────────────────────────────

function showLoading(x: number, y: number, w: number, h: number): void {
  removeResultPanel();
  const panel = createPanel(x, y, w, h);
  setInnerContent(panel, loadingHtml("Recognizing…", 0));
  document.body.appendChild(panel);
  resultPanelEl = panel;
}

function updateProgress(status: string, progress: number): void {
  if (!resultPanelEl) return;
  setInnerContent(resultPanelEl, loadingHtml(status, progress));
}

function loadingHtml(label: string, progress: number): string {
  const pct = Math.round(Math.min(1, progress) * 100);
  const showBar = pct > 0 && pct < 100;
  return `
    <div class="socr-loading">
      <span class="socr-spinner"></span>
      <span class="socr-loading-label">${escHtml(label)}</span>
      ${showBar ? `
        <div class="socr-progress-track">
          <div class="socr-progress-bar" style="width:${pct}%"></div>
        </div>
      ` : ""}
    </div>
  `;
}

// ── Result panel ──────────────────────────────────────────────────────────────

function showResult(msg: OcrResultMsg): void {
  if (!resultPanelEl || !selectionRect) return;
  lastOcrResult = msg;
  const { x, y, w, h } = selectionRect;
  const hasText = msg.text.trim().length > 0;

  setInnerContent(resultPanelEl, `
    <button class="socr-close" aria-label="Close">×</button>
    <div class="socr-text-label">OCR Text</div>
    <div class="socr-text">${escHtml(msg.text || "(no text recognized)")}</div>
    <div class="socr-actions">
      <button class="socr-copy" data-text="${escAttr(msg.text)}">Copy</button>
      ${hasText ? `<button class="socr-explain" data-text="${escAttr(msg.text)}">Explain</button>` : ""}
      <button class="socr-rescan">Re-scan</button>
    </div>
    ${msg.translation ? `
      <div class="socr-text-label">Translation</div>
      <div class="socr-text">${escHtml(msg.translation)}</div>
      <button class="socr-copy" data-text="${escAttr(msg.translation)}">Copy Translation</button>
    ` : ""}
    <div class="socr-elapsed">${msg.elapsed_ms} ms</div>
  `);

  repositionPanel(resultPanelEl, x, y, w, h);
  wirePanelButtons(resultPanelEl);
}

/** Replace all <img> tags on the page whose src matches the server result URL for this job. */
/**
 * Shows a revision, trying again a few times if it won't load. The live stream doesn't replay an event while it
 * stays open, so a publish whose download hit a passing network hiccup would otherwise sit unseen until the next
 * one. Retrying the same revision is safe: once a newer one has been asked for, `replacePageImages` skips the old.
 */
const REVISION_RETRIES = 3;

function showRevision(jobId: string, resultUrl: string, attempt = 0): void {
  replacePageImages(jobId, resultUrl).catch((err: unknown) => {
    if (attempt >= REVISION_RETRIES) {
      // The old revision stays on screen rather than a broken image
      console.warn("[web-ocr] republish not shown:", err);
      return;
    }
    setTimeout(() => showRevision(jobId, resultUrl, attempt + 1), 2000 * 2 ** attempt);
  });
}

/** Object URLs handed to images, so the previous revision's is released when a newer one arrives. */
const shownResults = new WeakMap<HTMLImageElement, string>();
/** The same images, as a set that can be walked: to release the URLs of images that have left the page. */
const imagesWithResults = new Set<HTMLImageElement>();
/**
 * The newest revision asked for, per job. Publishes can arrive faster than their images download; an older fetch
 * finishing last must not put the older picture back over the newer one.
 */
const latestRevisionRequested = new Map<string, number>();

/** Releases the object URLs of images no longer in the document. A moved image is still connected, and keeps its. */
function releaseDetachedResults(): void {
  for (const img of imagesWithResults) {
    if (img.isConnected) continue;
    const url = shownResults.get(img);
    if (url) URL.revokeObjectURL(url);
    shownResults.delete(img);
    imagesWithResults.delete(img);
  }
}

/**
 * Shows a newly published revision in every image on the page that came from this job.
 *
 * The result route needs an API key, and an `<img src>` has no way to send one — pointing the image at the URL got a
 * 401 and the browser's broken-image icon. So the bytes are fetched here, with the key, and handed to the image as an
 * object URL.
 */
async function replacePageImages(jobId: string, resultUrl: string): Promise<void> {
  if (!resultUrl) return;
  releaseDetachedResults();
  const targets = Array.from(document.querySelectorAll<HTMLImageElement>("img")).filter((img) => img.dataset.socrJobId === jobId);
  if (targets.length === 0) return;

  // This URL can arrive through a message relayed from the page itself — and the page is any website. So it is
  // checked before anything else is done with it: a hostile page could otherwise post itself an "image-updated"
  // pointing anywhere and collect the key, or claim revision 999 and have every real revision skipped as older.
  const { serverUrl, apiKey } = await loadServerAccess();
  let target: URL;
  try {
    target = new URL(resultUrl, `${serverUrl}/`);
  } catch {
    console.warn("[web-ocr] ignored a revision with an unreadable address");
    return;
  }
  if (!serverUrl || target.origin !== new URL(serverUrl).origin) {
    // Not an error to retry: it will never become the configured server
    console.warn(`[web-ocr] ignored a revision from ${target.origin}: it isn't the configured server`);
    return;
  }
  // …and only this page's result image: the key must not be spendable on any other route of that server
  const params = [...target.searchParams.keys()];
  const revOnly = params.length === 0 || (params.length === 1 && /^[1-9]\d{0,9}$/.test(target.searchParams.get("rev") ?? ""));
  if (target.pathname !== `/api/translate-page/${encodeURIComponent(jobId)}/result` || !revOnly || target.hash) {
    console.warn("[web-ocr] ignored a revision that isn't this page's result image");
    return;
  }

  // Older than something already asked for: not worth downloading, it would only be discarded
  const revision = revisionOf(target.toString());
  if (revision < (latestRevisionRequested.get(jobId) ?? 0)) return;
  latestRevisionRequested.set(jobId, revision);

  const response = await fetch(target, {
    headers: apiKey ? { "x-api-key": apiKey } : {},
    // Never follow a redirect with the key attached, and never show a cached older revision
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`the new revision couldn't be loaded (${response.status})`);
  const image = await response.blob();

  // A newer revision was asked for while this one downloaded: it gets the images, this one is dropped
  if (latestRevisionRequested.get(jobId) !== revision) return;

  for (const img of targets) {
    if (!img.isConnected) continue;
    const previous = shownResults.get(img);
    const url = URL.createObjectURL(image);
    img.srcset = "";
    img.src = url;
    shownResults.set(img, url);
    imagesWithResults.add(img);
    // Marked only once it is actually on screen, so a revision that failed to load is tried again next time
    if (revision > 0) img.dataset.socrRevision = String(revision);
    if (previous) URL.revokeObjectURL(previous);
  }
}

function showError(message: string): void {
  const rect = selectionRect;
  removeResultPanel();

  let panel: HTMLElement;
  if (rect) {
    panel = createPanel(rect.x, rect.y, rect.w, rect.h);
  } else {
    panel = document.createElement("div");
    panel.className = "socr-result-panel";
    panel.style.cssText = "position:fixed!important;top:20px!important;right:20px!important;";
    const inner = document.createElement("div");
    inner.className = "socr-panel-inner";
    panel.appendChild(inner);
    const rh = document.createElement("div");
    rh.className = "socr-resize-handle";
    rh.setAttribute("aria-hidden", "true");
    panel.appendChild(rh);
    makeDraggable(panel, inner);
    makeResizable(panel, rh);
  }

  setInnerContent(panel, `
    <button class="socr-close" aria-label="Close">×</button>
    <div class="socr-error">${escHtml(message)}</div>
  `);

  document.body.appendChild(panel);
  resultPanelEl = panel;
  wirePanelButtons(panel);
}

// ── Explain panel ─────────────────────────────────────────────────────────────

function showExplain(tokens: TokenInfo[], definitions: (JishoEntry | null)[], mode: "local" | "jisho"): void {
  if (!resultPanelEl) return;
  explainMode = mode;

  const seen = new Set<string>();
  explainItems = tokens
    .map((token, i) => ({ token, def: definitions[i] ?? null }))
    .filter((x): x is ExplainItem => {
      if (x.def === null) return false;
      const key = x.token.dictionary_form;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  explainPage = 0;
  renderExplainPage();
}

function renderExplainPage(): void {
  if (!resultPanelEl) return;
  const total = explainItems.length;
  const totalPages = Math.ceil(total / EXPLAIN_PAGE_SIZE);

  if (total === 0) {
    setInnerContent(resultPanelEl, `
      <button class="socr-close" aria-label="Close">×</button>
      <div class="socr-text-label">Explain</div>
      <div class="socr-text">No dictionary entries found.</div>
    `);
    wirePanelButtons(resultPanelEl);
    return;
  }

  const start = explainPage * EXPLAIN_PAGE_SIZE;
  const pageItems = explainItems.slice(start, start + EXPLAIN_PAGE_SIZE);

  const cardsHtml = pageItems.map(({ token, def }) => {
    const jlptText = explainMode === "jisho" && def.jlpt ? def.jlpt.replace("jlpt-", "").toUpperCase() : "";
    const jlptBadge = jlptText ? `<span class="socr-token-jlpt">${escHtml(jlptText)}</span>` : "";
    const commonBadge = explainMode === "jisho" && def.is_common ? `<span class="socr-token-common">common</span>` : "";
    const reading = def.romaji ? `<span class="socr-token-reading">${escHtml(def.romaji)}</span>` : "";
    const meaningsHtml = def.meanings.slice(0, 2)
      .map(m => `<div class="socr-token-meaning">${escHtml(formatMeaning(m, explainMode))}</div>`)
      .join("");

    return `<div class="socr-token-card">
      <div class="socr-token-header">
        <span class="socr-token-word">${escHtml(def.word || token.surface)}</span>
        ${reading}${jlptBadge}${commonBadge}
      </div>
      <div class="socr-token-meanings">${meaningsHtml || '<div class="socr-token-meaning socr-muted">—</div>'}</div>
    </div>`;
  }).join("");

  const pagerHtml = totalPages > 1 ? `
    <div class="socr-pager">
      <button class="socr-pager-btn" data-dir="-1"${explainPage === 0 ? " disabled" : ""}>←</button>
      <span class="socr-pager-info">${explainPage + 1} / ${totalPages}</span>
      <button class="socr-pager-btn" data-dir="1"${explainPage >= totalPages - 1 ? " disabled" : ""}>→</button>
    </div>
  ` : "";

  setInnerContent(resultPanelEl, `
    <button class="socr-close" aria-label="Close">×</button>
    <div class="socr-text-label">
      ${lastOcrResult ? `<button class="socr-back">← Back</button>` : ""}
      Explain — ${total} word${total === 1 ? "" : "s"}
    </div>
    <div class="socr-token-list">${cardsHtml}</div>
    ${pagerHtml}
  `);
  wirePanelButtons(resultPanelEl);
}

function showExplainError(message: string): void {
  if (!resultPanelEl) return;
  const btn = resultPanelEl.querySelector<HTMLButtonElement>(".socr-explain");
  if (btn) {
    btn.textContent = "Explain";
    btn.disabled = false;
    const errDiv = document.createElement("div");
    errDiv.className = "socr-explain-error socr-error";
    errDiv.style.cssText = "display:block!important;margin-top:4px!important;";
    errDiv.textContent = message;
    btn.insertAdjacentElement("afterend", errDiv);
    setTimeout(() => errDiv.remove(), 5000);
  }
}

// ── Panel helpers ─────────────────────────────────────────────────────────────

function repositionPanel(panel: HTMLElement, selX: number, selY: number, selW: number, selH: number): void {
  const pw = 360, ph = 260, margin = 10;
  let top = selY + selH + margin;
  if (top + ph > window.innerHeight - margin) top = selY - ph - margin;
  if (top < margin) top = margin;
  let left = selX + selW / 2 - pw / 2;
  if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
  if (left < margin) left = margin;

  panel.style.setProperty("position", "fixed", "important");
  panel.style.setProperty("top", `${top}px`, "important");
  panel.style.setProperty("left", `${left}px`, "important");
  panel.style.setProperty("width", `${pw}px`, "important");
  panel.style.setProperty("z-index", "2147483647", "important");
}

function wirePanelButtons(panel: HTMLElement): void {
  panel.querySelector(".socr-close")?.addEventListener("click", () => cleanup());

  panel.querySelector(".socr-rescan")?.addEventListener("click", () => {
    cleanup();
    startSelection();
  });

  panel.querySelector<HTMLButtonElement>(".socr-back")?.addEventListener("click", () => {
    if (lastOcrResult) showResult(lastOcrResult);
  });

  panel.querySelectorAll<HTMLButtonElement>(".socr-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.dataset["text"] ?? "";
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(console.error);
    });
  });

  const explainBtn = panel.querySelector<HTMLButtonElement>(".socr-explain");
  if (explainBtn) {
    explainBtn.addEventListener("click", () => {
      const text = explainBtn.dataset["text"] ?? "";
      if (!text.trim()) return;
      explainBtn.textContent = "Loading…";
      explainBtn.disabled = true;
      const msg: ExplainRequestMsg = { type: "explain-request", text };
      chrome.runtime.sendMessage(msg as unknown as FromContentMsg).catch(console.error);
    });
  }

  panel.querySelectorAll<HTMLButtonElement>(".socr-pager-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = parseInt(btn.dataset["dir"] ?? "0", 10);
      const totalPages = Math.ceil(explainItems.length / EXPLAIN_PAGE_SIZE);
      explainPage = Math.max(0, Math.min(totalPages - 1, explainPage + dir));
      renderExplainPage();
    });
  });
}

function removeResultPanel(): void {
  if (resultPanelEl) { resultPanelEl.remove(); resultPanelEl = null; }
}

function cleanup(): void {
  removeOverlay();
  removeResultPanel();
  exitImageMode();
  selectionRect = null;
  explainItems = [];
  explainPage = 0;
  lastOcrResult = null;
  activeRequestId = null;
}

// ── Image picker mode ─────────────────────────────────────────────────────────

let imagePickerActive = false;
let hoveredImg: HTMLImageElement | null = null;
let imagePickerHint: HTMLElement | null = null;
let imageTranslateOverlay: HTMLElement | null = null;
let imageTranslateLogList: HTMLElement | null = null;
let imageTranslateTitle: HTMLElement | null = null;
let activeEventSource: EventSource | null = null;

function startImageMode(): void {
  cleanup();
  imagePickerActive = true;

  const hint = document.createElement("div");
  hint.id = "socr-hint";
  hint.textContent = "Click an image to translate it — Esc to cancel";
  document.body.appendChild(hint);
  imagePickerHint = hint;

  document.addEventListener("mouseover", onImageHover, true);
  document.addEventListener("mouseout", onImageOut, true);
  document.addEventListener("click", onImageClick, true);
  document.addEventListener("keydown", onImagePickerKeydown);
}

function exitImageMode(): void {
  // Always close the stream — it may be opened after imagePickerActive was cleared
  activeEventSource?.close();
  activeEventSource = null;

  if (!imagePickerActive) return;
  imagePickerActive = false;
  document.removeEventListener("mouseover", onImageHover, true);
  document.removeEventListener("mouseout", onImageOut, true);
  document.removeEventListener("click", onImageClick, true);
  document.removeEventListener("keydown", onImagePickerKeydown);
  if (hoveredImg) {
    hoveredImg.style.outline = "";
    hoveredImg.style.cursor = "";
    hoveredImg = null;
  }
  imagePickerHint?.remove();
  imagePickerHint = null;
}

function onImageHover(e: MouseEvent): void {
  const el = e.target as HTMLElement;
  if (el.tagName !== "IMG") return;
  if (hoveredImg && hoveredImg !== el) {
    hoveredImg.style.outline = "";
    hoveredImg.style.cursor = "";
  }
  hoveredImg = el as HTMLImageElement;
  hoveredImg.style.outline = "3px solid #89b4fa";
  hoveredImg.style.cursor = "pointer";
}

function onImageOut(e: MouseEvent): void {
  const el = e.target as HTMLElement;
  if (el.tagName !== "IMG") return;
  (el as HTMLElement).style.outline = "";
  (el as HTMLElement).style.cursor = "";
  if (hoveredImg === el) hoveredImg = null;
}

function onImageClick(e: MouseEvent): void {
  if (!imagePickerActive) return;
  const el = e.target as HTMLElement;
  if (el.tagName !== "IMG") return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  exitImageMode();
  void uploadImageForTranslation(el as HTMLImageElement);
}

function onImagePickerKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") exitImageMode();
}

async function uploadImageForTranslation(img: HTMLImageElement): Promise<void> {
  // Claimed at the start, before any await: a newer translation that starts while this one is still uploading or
  // fetching a token takes over, and this one's late failures are no longer anybody's business
  const generation = ++jobGeneration;
  const isCurrent = (): boolean => generation === jobGeneration;
  showImageTranslateLoading();

  try {
    // Get image as base64 — try canvas first (same-origin), fall back to background fetch
    let base64: string;
    const src = img.currentSrc || img.src;

    try {
      base64 = await imageElementToBase64(img);
    } catch {
      // Cross-origin: ask background service worker to fetch
      const fetchMsg: FetchImageMsg = { type: "fetch-image", url: src };
      const result = await chrome.runtime.sendMessage(fetchMsg as unknown as FromContentMsg) as
        | { base64: string; error?: undefined }
        | { error: string; base64?: undefined }
        | undefined;
      if (!result) throw new Error("Extension service worker not responding");
      if (result.error ?? !result.base64) throw new Error(result.error ?? "Failed to fetch image");
      base64 = result.base64;
    }

    const { serverUrl, apiKey, cleanSfx } = await loadServerAccess();
    if (!serverUrl) throw new Error("No server URL configured. Open extension settings.");
    if (!apiKey) {
      throw new Error(
        "No API key is being sent. Make one on the server's account page and paste it into extension settings — and if"
        + " the server's address is plain http on your network, tick the box that allows sending it there.",
      );
    }

    const { data, error } = await serverApi(serverUrl, apiKey).api["translate-page"].post({
      image: base64,
      clean_sfx: cleanSfx,
    });
    if (error) throw new Error(errorMessage(error));
    appendLogEntry(data.cached ? "Found a previous translation ✓" : "Uploaded ✓", "uploaded");

    // Server-sent events replay the job's whole history, so nothing is missed between submit and connect — and a
    // reopened stream replays it again, which is why what has already been shown is counted and skipped
    // Overtaken during the upload: the newer translation owns the panel and the stream
    if (!isCurrent()) return;
    activeEventSource?.close();
    let seen = 0;

    const onJobEvent = (es: EventSource, event: MessageEvent<string>, skip: { remaining: number }): void => {
      // A newer translation owns the panel from the moment it claims its number — even while it is still uploading.
      // This stream's news is no longer anybody's, so it closes itself rather than writing into the other's overlay.
      if (!isCurrent()) {
        es.close();
        if (activeEventSource === es) activeEventSource = null;
        return;
      }
      if (skip.remaining > 0) {
        skip.remaining--;
        return;
      }
      seen++;
      const update = JSON.parse(event.data) as PageJobEvent;
      switch (update.type) {
        case "log":
          appendLogEntry(update.message, update.stage);
          setImageTranslateProgress(update.progress);
          break;
        case "progress":
          setImageTranslateProgress(update.progress, update.message);
          break;
        case "done":
          es.close();
          activeEventSource = null;
          img.src = `data:image/png;base64,${update.result}`;
          img.srcset = "";
          img.dataset.socrJobId = data.job_id;
          img.dataset.socrRevision = String(revisionOf(update.result_url));
          watchPageUpdates(serverUrl, data.job_id, apiKey).catch((err: unknown) => {
            // Live updates need their own token; without it the page still translated, it just won't refresh itself
            appendLogEntry(`Live updates unavailable: ${err instanceof Error ? err.message : String(err)}`, "warn");
          });
          setImageTranslateProgress(1);
          appendLogEntry(`Image replaced ✓ (${(update.elapsed_ms / 1000).toFixed(1)} s)`, "done");
          appendStudioLink(`${serverUrl}/studio/pages/${data.job_id}`);
          // A newer translation may have opened its own overlay by then; only this one's is ours to hide
          setTimeout(() => {
            if (isCurrent()) hideImageTranslateLoading(true);
          }, 4000);
          break;
        case "error":
          es.close();
          activeEventSource = null;
          hideImageTranslateLoading(false, update.error);
          break;
      }
    };

    /**
     * Opens (or reopens) the job's stream with a fresh token. A dropped connection or an expired token closes an
     * EventSource for good, so it is replaced rather than left to retry a URL the server will keep refusing.
     */
    const openJobStream = async (failures: number): Promise<void> => {
      const url = await streamUrl(serverUrl, `api/translate-page/${data.job_id}/events`, apiKey);
      // Overtaken while the token was being fetched: leave the newer translation's stream alone
      if (!isCurrent()) return;
      const es = new EventSource(url);
      activeEventSource = es;
      const skip = { remaining: seen };
      let opened = false;
      es.onopen = () => {
        opened = true;
      };
      es.onmessage = (event: MessageEvent<string>) => onJobEvent(es, event, skip);
      es.onerror = () => {
        if (activeEventSource !== es) return;
        es.close();
        reopenJob(opened ? 1 : failures + 1);
      };
    };

    /**
     * Tries again after a dropped stream. Fetching the fresh token can fail too — the server restarting, the network
     * blinking — and that counts as one more failure against the same budget rather than ending the translation.
     */
    const reopenJob = (failures: number): void => {
      if (failures > MAX_STREAM_FAILURES) {
        // A stale translation giving up must not tear down a newer one's panel
        if (!isCurrent()) return;
        activeEventSource = null;
        hideImageTranslateLoading(false, "Connection to server lost");
        return;
      }
      setTimeout(() => {
        if (!isCurrent()) return;
        openJobStream(failures).catch(() => reopenJob(failures + 1));
      }, reopenDelay(failures));
    };

    // A token that can't be fetched the first time goes through the same bounded retries as a dropped stream
    await openJobStream(0).catch(() => reopenJob(1));

  } catch (e) {
    // Only the translation still on screen reports; an older one failing late would hide the newer one's panel
    if (isCurrent()) hideImageTranslateLoading(false, e instanceof Error ? e.message : String(e));
  }
}

/** Publish revision in a result URL (`…/result?rev=N`); 0 when absent, i.e. the page was never published. */
function revisionOf(resultUrl: string): number {
  const rev = Number(new URL(resultUrl, location.href).searchParams.get("rev"));
  return Number.isInteger(rev) && rev > 0 ? rev : 0;
}

/** Live streams per translated page; they stay open while this tab shows the page. */
const pageWatchers = new Map<string, EventSource>();
/**
 * Which start of a page's watcher is the current one. It is taken before the token is fetched, so two starts racing
 * for the same page can't both open a stream — and a stop that lands during the fetch is noticed afterwards.
 */
const watcherGenerations = new Map<string, number>();
/** The same, for the translation currently in progress. */
let jobGeneration = 0;
let watcherObserver: MutationObserver | null = null;
let watcherCheckQueued = false;

/** Close the streams whose translated image left the page (e.g. a reader swapped pages). */
function closeDetachedWatchers(): void {
  watcherCheckQueued = false;
  releaseDetachedResults();
  for (const jobId of [...pageWatchers.keys()]) {
    if (!document.querySelector(`img[data-socr-job-id="${CSS.escape(jobId)}"]`)) stopWatching(jobId);
  }
}

/** Every stream removal goes through here: closes the stream and stops the observer once nothing is watched. */
function stopWatching(jobId: string): void {
  pageWatchers.get(jobId)?.close();
  pageWatchers.delete(jobId);
  // Anything still fetching a token for this page will see it has been stopped
  watcherGenerations.delete(jobId);
  if (pageWatchers.size === 0) {
    watcherObserver?.disconnect();
    watcherObserver = null;
  }
}

/** Watches DOM removals while any live stream is open; checks are batched per animation frame. */
function observeWatchedImages(): void {
  if (watcherObserver) return;
  watcherObserver = new MutationObserver((mutations) => {
    if (watcherCheckQueued || !mutations.some((m) => m.removedNodes.length > 0)) return;
    watcherCheckQueued = true;
    requestAnimationFrame(closeDetachedWatchers);
  });
  watcherObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * How many times in a row a stream may fail to reopen before it is given up on. A stream that opened resets the
 * count, so a watcher that lives for hours — reopening every time its token runs out — never reaches it.
 */
const MAX_STREAM_FAILURES = 5;

/** Wait before reopening: 1 s, 2 s, 4 s… capped at 30 s, so a server that is down isn't hammered. */
const reopenDelay = (failures: number): number => Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));

/**
 * Swap in the new result whenever the page is published from the Studio.
 *
 * The stream's token lasts fifteen minutes, and EventSource reconnects with the URL it was given — so once the token
 * has run out, the server refuses the reconnect and the stream closes for good. When that happens and the page is
 * still being watched, a new token is fetched and the stream reopened.
 */
async function watchPageUpdates(serverUrl: string, jobId: string, apiKey: string, failures = 0): Promise<void> {
  // A first start is refused while one is already running *or still fetching its token*
  if (failures === 0 && watcherGenerations.has(jobId)) return;
  const generation = (watcherGenerations.get(jobId) ?? 0) + 1;
  watcherGenerations.set(jobId, generation);

  let url: string;
  try {
    url = await streamUrl(serverUrl, `api/translate-page/${jobId}/live`, apiKey);
  } catch (err) {
    // A first start that fails leaves nothing behind; a reopen keeps its claim so it can be tried again
    if (failures === 0 && watcherGenerations.get(jobId) === generation) watcherGenerations.delete(jobId);
    throw err;
  }
  // Stopped, or started again, while the token was being fetched: this attempt is no longer wanted
  if (watcherGenerations.get(jobId) !== generation) return;

  const es = new EventSource(url);
  pageWatchers.set(jobId, es);
  observeWatchedImages();

  let opened = false;
  es.onopen = () => {
    opened = true;
  };

  es.onmessage = (event: MessageEvent<string>) => {
    const update = JSON.parse(event.data) as PageLiveEvent;
    if (update.type !== "page-updated") return;
    const shown = document.querySelectorAll<HTMLImageElement>(`img[data-socr-job-id="${CSS.escape(jobId)}"]`);
    if (shown.length === 0) {
      // The image left the page (e.g. the reader moved on): stop listening
      stopWatching(jobId);
      return;
    }
    // The server repeats the current revision on connect (catch-up), so only swap for a newer one
    const newest = Math.max(...Array.from(shown, (img) => Number(img.dataset.socrRevision ?? 0)));
    if (update.revision <= newest) return;
    showRevision(jobId, `${serverUrl}${update.result_url}`);
  };

  // EventSource reconnects on its own after network errors; it only closes for good when the server refuses the
  // stream — most often because its token has expired, which a new token fixes
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED || pageWatchers.get(jobId) !== es) return;
    // Out of the map while it waits, so the reopen can take its place; the claim stays, so a stop still cancels it
    pageWatchers.delete(jobId);
    reopenWatcher(serverUrl, jobId, apiKey, opened ? 1 : failures + 1);
  };
}

/**
 * Tries a watcher again after its stream closed. As with the job stream, a fresh token that can't be fetched is one
 * more failure within the budget, not a reason to stop listening for publishes.
 */
function reopenWatcher(serverUrl: string, jobId: string, apiKey: string, failures: number): void {
  if (failures > MAX_STREAM_FAILURES) {
    stopWatching(jobId);
    return;
  }
  setTimeout(() => {
    // Stopped while waiting, or already running again
    if (!watcherGenerations.has(jobId) || pageWatchers.has(jobId)) return;
    // Out of the map while it waited, the observer's sweep couldn't see it: check the image is still here
    if (!document.querySelector(`img[data-socr-job-id="${CSS.escape(jobId)}"]`)) {
      stopWatching(jobId);
      return;
    }
    watchPageUpdates(serverUrl, jobId, apiKey, failures).catch(() => reopenWatcher(serverUrl, jobId, apiKey, failures + 1));
  }, reopenDelay(failures));
}

/** Link from the progress panel to the page in the Studio. */
function appendStudioLink(url: string): void {
  if (!imageTranslateLogList) return;
  const link = document.createElement("a");
  link.className = "socr-log-entry";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Open in Studio ↗";
  imageTranslateLogList.appendChild(link);
}

/** Show overall progress (and the current step) in the loading panel's title. */
function setImageTranslateProgress(progress: number, step?: string): void {
  if (!imageTranslateTitle) return;
  const percent = `${Math.round(progress * 100)}%`;
  imageTranslateTitle.textContent = step ? `Translating page… ${percent} — ${step}` : `Translating page… ${percent}`;
}

async function imageElementToBase64(img: HTMLImageElement): Promise<string> {
  // Throws SecurityError for cross-origin images
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w === 0 || h === 0) throw new Error("Image has zero dimensions — not yet loaded?");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1] ?? "";
}

function showImageTranslateLoading(): void {
  // Remove any previous overlay before creating a new one
  if (imageTranslateOverlay) {
    imageTranslateOverlay.remove();
    imageTranslateOverlay = null;
    imageTranslateLogList = null;
  }
  const panel = document.createElement("div");
  panel.className = "socr-result-panel socr-img-log-panel";

  const inner = document.createElement("div");
  inner.className = "socr-panel-inner";

  const title = document.createElement("div");
  title.className = "socr-text-label";
  title.style.cssText = "margin-top:0!important;margin-bottom:8px!important;";
  title.textContent = "Translating page…";

  const logList = document.createElement("div");
  logList.className = "socr-log-list";

  inner.appendChild(title);
  inner.appendChild(logList);
  panel.appendChild(inner);
  document.body.appendChild(panel);

  imageTranslateOverlay = panel;
  imageTranslateLogList  = logList;
  imageTranslateTitle    = title;

  // First entry — pending while upload is in flight
  appendLogEntry("Uploading image…", "upload");
}

function appendLogEntry(message: string, stage?: string): void {
  if (!imageTranslateLogList) return;

  // Mark the previous pending entry as done when the next one arrives
  const prev = imageTranslateLogList.lastElementChild as HTMLElement | null;
  if (prev?.dataset["pending"] === "1") {
    prev.dataset["pending"] = "0";
    const dot = prev.querySelector<HTMLElement>(".socr-log-dot");
    if (dot) {
      dot.textContent = "✓";
      dot.classList.remove("socr-log-dot-spin");
    }
  }

  const isDone = stage === "done" || stage === "error";

  const entry = document.createElement("div");
  entry.className = "socr-log-entry";
  entry.dataset["pending"] = isDone ? "0" : "1";

  const dot = document.createElement("span");
  dot.className = "socr-log-dot" + (isDone ? "" : " socr-log-dot-spin");
  dot.textContent = isDone ? "✓" : "●";

  const text = document.createElement("span");
  text.className = "socr-log-text";
  text.textContent = message;

  entry.appendChild(dot);
  entry.appendChild(text);
  imageTranslateLogList.appendChild(entry);
  imageTranslateLogList.scrollTop = imageTranslateLogList.scrollHeight;
}

function hideImageTranslateLoading(success: boolean, errorMsg?: string): void {
  if (!imageTranslateOverlay) return;
  if (success) {
    imageTranslateOverlay.remove();
    imageTranslateOverlay = null;
    imageTranslateLogList  = null;
    imageTranslateTitle    = null;
  } else {
    appendLogEntry(`✗ ${errorMsg ?? "Failed"}`, "error");
    const overlay = imageTranslateOverlay;
    setTimeout(() => {
      overlay.remove();
      if (imageTranslateOverlay === overlay) {
        imageTranslateOverlay = null;
        imageTranslateLogList  = null;
        imageTranslateTitle    = null;
      }
    }, 5000);
  }
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function makeDraggable(panel: HTMLElement, dragTarget: HTMLElement): void {
  let dragging = false;
  let offsetX = 0, offsetY = 0;

  dragTarget.style.cursor = "grab";

  dragTarget.addEventListener("mousedown", (e: MouseEvent) => {
    const t = e.target as Element;
    if (t.closest("button, .socr-text, .socr-token-list, .socr-pager")) return;
    dragging = true;
    offsetX = e.clientX - panel.getBoundingClientRect().left;
    offsetY = e.clientY - panel.getBoundingClientRect().top;
    dragTarget.style.cursor = "grabbing";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!dragging) return;
    panel.style.setProperty("left", `${e.clientX - offsetX}px`, "important");
    panel.style.setProperty("top", `${e.clientY - offsetY}px`, "important");
  });

  document.addEventListener("mouseup", () => {
    if (dragging) { dragging = false; dragTarget.style.cursor = "grab"; }
  });
}

// ── Resize ────────────────────────────────────────────────────────────────────

function makeResizable(panel: HTMLElement, handle: HTMLElement): void {
  let resizing = false;
  let startX = 0, startY = 0, startW = 0, startH = 0;

  handle.addEventListener("mousedown", (e: MouseEvent) => {
    resizing = true;
    startX = e.clientX; startY = e.clientY;
    startW = panel.offsetWidth; startH = panel.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!resizing) return;
    panel.style.setProperty("width",      `${Math.max(280, startW + (e.clientX - startX))}px`, "important");
    panel.style.setProperty("height",     `${Math.max(100, startH + (e.clientY - startY))}px`, "important");
    panel.style.setProperty("max-height", "none", "important");
  });

  document.addEventListener("mouseup", () => { resizing = false; });
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return escHtml(s).replace(/'/g, "&#39;");
}

function formatMeaning(s: string, mode: "local" | "jisho"): string {
  if (mode === "jisho") return s.length > 100 ? s.slice(0, 97) + "…" : s;
  s = s.replace(/^(noun|verb|adjective|adverb|suffix|prefix|interjection|particle|auxiliary|conjunction|counter|expression|idiom|phrase|proverb|5-dan|intransitive|transitive|archaic|slang|abbr\.?)\s*/i, "").trimStart();
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const jpIdx = s.search(/[　-鿿豈-﫿぀-ゟ゠-ヿ]/);
  if (jpIdx > 3) s = s.slice(0, jpIdx).replace(/[,;]\s*$/, "").trimEnd();
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 100 ? s.slice(0, 97) + "…" : s;
}
