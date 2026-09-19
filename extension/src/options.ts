import type { Settings, OcrEngine, ServerTranslation, ClientTranslation, DictMode, TesseractQuality } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { isPlainHttpOverNetwork, loadSettings, saveSettings as persistSettings } from "./settings-store";
import { errorMessage, serverApi } from "./api";

// ── Elements ──────────────────────────────────────────────────────────────────

const tesseractSection           = document.getElementById("tesseractSection")!;
const serverSection              = document.getElementById("serverSection")!;
const tabTesseract               = document.getElementById("tab-tesseract")!;
const tabServer                  = document.getElementById("tab-server")!;

const tesseractLangInput         = document.getElementById("tesseractLang")           as HTMLSelectElement;
const tesseractQualitySel        = document.getElementById("tesseractQuality")        as HTMLSelectElement;
const checkLangBtn               = document.getElementById("checkLangBtn")            as HTMLButtonElement;
const checkLangStatus            = document.getElementById("checkLangStatus")!;

const clientTranslationSel       = document.getElementById("clientTranslation")       as HTMLSelectElement;
const deeplFields                = document.getElementById("deeplFields")!;
const deeplApiKeyInput           = document.getElementById("deeplApiKey")             as HTMLInputElement;
const deeplTargetLangSel         = document.getElementById("deeplTargetLang")         as HTMLSelectElement;

const serverUrlInput             = document.getElementById("serverUrl")               as HTMLInputElement;
const serverApiKeyInput          = document.getElementById("serverApiKey")            as HTMLInputElement;
const allowInsecureInput         = document.getElementById("allowInsecureServer")     as HTMLInputElement;
const insecureField              = document.getElementById("insecureField")           as HTMLElement;
const serverTranslationSel       = document.getElementById("serverTranslation")       as HTMLSelectElement;
const dictModeSelect             = document.getElementById("dictMode")                as HTMLSelectElement;
const pageCleanSfxInput          = document.getElementById("pageCleanSfx")            as HTMLInputElement;
const testBtn                    = document.getElementById("testBtn")                 as HTMLButtonElement;
const testBtnStatus              = document.getElementById("testBtnStatus")!;

const clientTranslationServerSel = document.getElementById("clientTranslationServer") as HTMLSelectElement;
const deeplFieldsServer          = document.getElementById("deeplFieldsServer")!;
const deeplApiKeyServerInput     = document.getElementById("deeplApiKeyServer")       as HTMLInputElement;
const deeplTargetLangServerSel   = document.getElementById("deeplTargetLangServer")   as HTMLSelectElement;

const saveBtn                    = document.getElementById("saveBtn")                 as HTMLButtonElement;
const statusEl                   = document.getElementById("status")                  as HTMLDivElement;

// ── Gate state ────────────────────────────────────────────────────────────────

let activeEngine: OcrEngine = DEFAULT_SETTINGS.ocrEngine;
let tesseractVerified = false;
let serverVerified    = false;

function updateSaveBtn(): void {
  const blocked = activeEngine === "tesseract" ? !tesseractVerified : !serverVerified;
  saveBtn.disabled = blocked;
  saveBtn.title    = blocked
    ? activeEngine === "tesseract"
      ? "Check language data first"
      : "Test server connection first"
    : "";
}

// ── Engine tabs ───────────────────────────────────────────────────────────────

function setEngine(engine: OcrEngine): void {
  activeEngine = engine;
  tabTesseract.classList.toggle("active", engine === "tesseract");
  tabServer.classList.toggle("active",    engine === "server");
  tesseractSection.style.display = engine === "tesseract" ? "block" : "none";
  serverSection.style.display    = engine === "server"    ? "block" : "none";
  updateSaveBtn();
}

tabTesseract.addEventListener("click", () => setEngine("tesseract"));
tabServer.addEventListener("click",    () => setEngine("server"));

// ── Tesseract: language / quality changes reset verification ──────────────────

function resetTesseractVerified(): void {
  tesseractVerified = false;
  checkLangStatus.textContent = "";
  checkLangStatus.className = "inline-status";
  updateSaveBtn();
}

tesseractLangInput.addEventListener("change", resetTesseractVerified);
tesseractQualitySel.addEventListener("change", resetTesseractVerified);

// ── Tesseract: check language data ────────────────────────────────────────────

checkLangBtn.addEventListener("click", () => { void checkLangData(); });

async function checkLangData(): Promise<void> {
  const lang    = tesseractLangInput.value.trim() || "eng";
  const quality = tesseractQualitySel.value;
  const url     = `https://tessdata.projectnaptha.com/${quality}/${lang}.traineddata.gz`;

  checkLangBtn.disabled = true;
  checkLangBtn.textContent = "Checking…";
  setInlineStatus(checkLangStatus, "", "");

  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    if (res.ok || res.status === 403) {
      // 403 can occur on HEAD even when GET works (CDN quirk) — treat as reachable
      tesseractVerified = true;
      setInlineStatus(checkLangStatus, `✅ Language data found (${lang})`, "ok");
    } else {
      tesseractVerified = false;
      setInlineStatus(checkLangStatus, `❌ Not found (HTTP ${res.status}) — check language code`, "err");
    }
  } catch (e) {
    // Some CDNs block HEAD; try GET with Range to avoid full download
    try {
      const res2 = await fetch(url, {
        method: "GET",
        headers: { "Range": "bytes=0-0" },
        signal: AbortSignal.timeout(8000),
      });
      if (res2.ok || res2.status === 206 || res2.status === 403) {
        tesseractVerified = true;
        setInlineStatus(checkLangStatus, `✅ Language data found (${lang})`, "ok");
      } else {
        tesseractVerified = false;
        setInlineStatus(checkLangStatus, `❌ Language "${lang}" not available`, "err");
      }
    } catch {
      tesseractVerified = false;
      setInlineStatus(checkLangStatus, `❌ Network error — ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  } finally {
    checkLangBtn.disabled = false;
    checkLangBtn.textContent = "Check Language";
    updateSaveBtn();
  }
}

// ── Server: URL change resets verification ────────────────────────────────────

/** The choice only makes sense for an address that would actually expose the key. */
function updateInsecureVisibility(): void {
  insecureField.style.display = isPlainHttpOverNetwork(serverUrlInput.value.trim()) ? "block" : "none";
}

allowInsecureInput.addEventListener("change", () => {
  serverVerified = false;
  setInlineStatus(testBtnStatus, "", "");
  updateSaveBtn();
});

serverApiKeyInput.addEventListener("input", () => {
  // A new key hasn't been tried yet, so the connection has to be proved again
  serverVerified = false;
  setInlineStatus(testBtnStatus, "", "");
  updateSaveBtn();
});

serverUrlInput.addEventListener("input", () => {
  updateInsecureVisibility();
  serverVerified = false;
  setInlineStatus(testBtnStatus, "", "");
  updateSaveBtn();
});

// ── Server: test connection ───────────────────────────────────────────────────

testBtn.addEventListener("click", () => { void testConnection(); });

async function testConnection(): Promise<void> {
  const url = serverUrlInput.value.trim();
  if (!url) { showStatus("Please enter a server URL first.", "error"); return; }

  testBtn.disabled = true;
  testBtn.textContent = "Testing…";
  setInlineStatus(testBtnStatus, "", "");

  try {
    const { data, error } = await serverApi(url).health.get({ fetch: { signal: AbortSignal.timeout(5000) } });
    if (error) {
      serverVerified = false;
      setInlineStatus(testBtnStatus, `❌ ${errorMessage(error)}`, "err");
    } else {
      const mark = (ready: boolean | "disabled"): string => (ready === true ? "✓" : ready === "disabled" ? "off" : "✗");
      const models = `OCR ${mark(data.ocr)} · Translate ${mark(data.translate)} · Dictionary ${mark(data.dictionary)} · Text detection ${mark(data.text_seg)} · Inpaint ${mark(data.inpaint)}`;
      const connected = data.status === "starting" ? "⏳ Connected, models still loading" : "✅ Connected";
      const key = serverApiKeyInput.value.trim();

      // Decided before anything is sent: testing the key would be the first thing to leak it
      if (key !== "" && isPlainHttpOverNetwork(url) && !allowInsecureInput.checked) {
        serverVerified = false;
        setInlineStatus(
          testBtnStatus,
          `${connected} — but this address isn't https and isn't on this machine, so the key would cross the network in clear. Use https, or tick the box below if you trust this network.`,
          "err",
        );
        return;
      }

      // Health is open to anyone; the key is what OCR will actually be judged by, so try it too
      const keyCheck = key
        ? await serverApi(url, key).api.whoami.get({ fetch: { signal: AbortSignal.timeout(5000) } })
        : null;
      const keyNote = !key
        ? "⚠️ no API key — OCR will be refused"
        : keyCheck?.error
          ? `❌ the key was refused (${errorMessage(keyCheck.error)})`
          : `key accepted as ${keyCheck?.data?.username ?? "?"} ✓`;
      serverVerified = key !== "" && !keyCheck?.error;
      setInlineStatus(testBtnStatus, `${connected} — ${models} · ${keyNote}`, serverVerified ? "ok" : "err");
    }
  } catch (e) {
    serverVerified = false;
    setInlineStatus(testBtnStatus, `❌ ${e instanceof Error ? e.message : String(e)}`, "err");
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "Test Connection";
    updateSaveBtn();
  }
}



// ── Client translation visibility ─────────────────────────────────────────────

clientTranslationSel.addEventListener("change", () => {
  deeplFields.style.display = clientTranslationSel.value === "deepl" ? "block" : "none";
});

clientTranslationServerSel.addEventListener("change", () => {
  deeplFieldsServer.style.display = clientTranslationServerSel.value === "deepl" ? "block" : "none";
});

// ── Server translation hints ──────────────────────────────────────────────────

const serverHints: Record<ServerTranslation, HTMLElement | null> = {
  none:  document.getElementById("serverHint-none"),
  auto:  document.getElementById("serverHint-auto"),
  local: document.getElementById("serverHint-local"),
  deepl: document.getElementById("serverHint-deepl"),
};

serverTranslationSel.addEventListener("change", () => {
  const mode = serverTranslationSel.value as ServerTranslation;
  for (const [k, el] of Object.entries(serverHints)) {
    if (el) el.style.display = k === mode ? "block" : "none";
  }
});

// ── Dict mode hints ───────────────────────────────────────────────────────────

const dictHints: Record<DictMode, HTMLElement | null> = {
  jisho: document.getElementById("dictHint-jisho"),
  local: document.getElementById("dictHint-local"),
};

dictModeSelect.addEventListener("change", () => {
  const mode = dictModeSelect.value as DictMode;
  for (const [k, el] of Object.entries(dictHints)) {
    if (el) el.style.display = k === mode ? "block" : "none";
  }
});

// ── Load saved settings ───────────────────────────────────────────────────────

loadSettings()
  .then((s) => {

    tesseractLangInput.value    = s.tesseractLang;
    tesseractQualitySel.value   = s.tesseractQuality;

    clientTranslationSel.value  = s.clientTranslation;
    deeplApiKeyInput.value      = s.deeplApiKey;
    deeplTargetLangSel.value    = s.deeplTargetLang;
    deeplFields.style.display   = s.clientTranslation === "deepl" ? "block" : "none";

    serverUrlInput.value        = s.serverUrl;
    serverApiKeyInput.value     = s.serverApiKey;
    allowInsecureInput.checked  = s.allowInsecureServer;
    updateInsecureVisibility();
    serverTranslationSel.value  = s.serverTranslation;
    dictModeSelect.value        = s.dictMode;
    pageCleanSfxInput.checked   = s.pageCleanSfx;

    clientTranslationServerSel.value = s.clientTranslation;
    deeplApiKeyServerInput.value     = s.deeplApiKey;
    deeplTargetLangServerSel.value   = s.deeplTargetLang;
    deeplFieldsServer.style.display  = s.clientTranslation === "deepl" ? "block" : "none";

    // Apply hints
    const sHint = serverHints[s.serverTranslation];
    for (const [k, el] of Object.entries(serverHints)) {
      if (el) el.style.display = k === s.serverTranslation ? "block" : "none";
    }
    const dHint = dictHints[s.dictMode];
    for (const [k, el] of Object.entries(dictHints)) {
      if (el) el.style.display = k === s.dictMode ? "block" : "none";
    }
    void sHint; void dHint;

    // If they've previously saved settings, treat as pre-verified so they can re-save
    if (s.ocrEngine === "tesseract" && s.tesseractLang) {
      tesseractVerified = true;
      setInlineStatus(checkLangStatus, `Previously saved: ${s.tesseractLang}`, "ok");
    }
    if (s.ocrEngine === "server" && s.serverUrl) {
      serverVerified = true;
      setInlineStatus(testBtnStatus, "Previously saved — re-test if URL changed", "ok");
    }

    setEngine(s.ocrEngine);
  })
  .catch(console.error);

// ── Save ──────────────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => { void saveSettings(); });

async function saveSettings(): Promise<void> {
  if (activeEngine === "server") {
    const url = serverUrlInput.value.trim();
    try { new URL(url); } catch {
      showStatus("Please enter a valid URL (e.g. http://localhost:3579)", "error");
      return;
    }
  }

  const clientTranslation = activeEngine === "server"
    ? clientTranslationServerSel.value as ClientTranslation
    : clientTranslationSel.value as ClientTranslation;
  const deeplApiKey = activeEngine === "server"
    ? deeplApiKeyServerInput.value.trim()
    : deeplApiKeyInput.value.trim();
  const deeplTargetLang = activeEngine === "server"
    ? deeplTargetLangServerSel.value
    : deeplTargetLangSel.value;

  if (clientTranslation === "deepl" && !deeplApiKey) {
    showStatus("Please enter your DeepL API key.", "error");
    return;
  }

  const settings: Settings = {
    ocrEngine:         activeEngine,
    serverUrl:         serverUrlInput.value.trim(),
    serverApiKey:      serverApiKeyInput.value.trim(),
    allowInsecureServer: allowInsecureInput.checked,
    serverTranslation: serverTranslationSel.value as ServerTranslation,
    dictMode:          dictModeSelect.value as DictMode,
    pageCleanSfx:      pageCleanSfxInput.checked,
    tesseractLang:     tesseractLangInput.value,
    tesseractQuality:  tesseractQualitySel.value as TesseractQuality,
    clientTranslation,
    deeplApiKey,
    deeplTargetLang,
  };

  await persistSettings(settings);
  showStatus("✅ Settings saved!", "success");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setInlineStatus(el: HTMLElement, msg: string, type: "ok" | "err" | ""): void {
  el.textContent = msg;
  el.className   = `inline-status${type ? ` inline-${type}` : ""}`;
}

function showStatus(msg: string, type: "success" | "error"): void {
  statusEl.textContent = msg;
  statusEl.className   = `status-${type}`;
  statusEl.style.display = "block";
  setTimeout(() => { statusEl.style.display = "none"; }, 4000);
}
