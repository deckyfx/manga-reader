/**
 * The popup's chapter import panel: what the extractor found on this page, what to do with it, and how far the
 * import has got.
 *
 * Everything the page supplied — titles, image addresses — is put on screen with `textContent`, never as markup: it
 * comes from whatever site the user happens to be on.
 */
import { findWorkspaceBySource, type WorkspaceRef } from "./api";
import type { ChapterExtractResult } from "./chapter-extract";
import { loadServerAccess } from "./settings-store";
import type { ImportRequest } from "./types";

/** The background worker's answer to `import-status`. */
interface ImportStatusReply {
  job: {
    workspaceId: number;
    workspaceName: string;
    pages: { index: number; url: string; state: string; reason?: string }[];
    finishedAt?: number;
    error?: string;
  } | null;
  done: number;
  failed: number;
  total: number;
  running: boolean;
}

const POLL_MS = 900;
/** Enough of the list to spot a wrong guess without making the popup enormous. */
const PREVIEW_ROWS = 12;

let pollTimer: number | undefined;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function body(): HTMLElement {
  const node = document.getElementById("import-body");
  if (!node) throw new Error("the popup is missing its import panel");
  return node;
}

function show(...nodes: Node[]): void {
  const panel = body();
  panel.replaceChildren(...nodes);
}

function message(text: string, tone: "muted" | "error" = "muted"): void {
  show(el("p", tone === "error" ? "error" : "muted", text));
}

const send = <T>(msg: unknown): Promise<T> => chrome.runtime.sendMessage(msg) as Promise<T>;

/** The tab the user is looking at, when it is a page a content script can read. */
async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return null;
  return tab;
}

// ── Progress ─────────────────────────────────────────────────────────────────

async function renderProgress(status: ImportStatusReply): Promise<void> {
  const { job } = status;
  if (!job) return;
  const finished = job.finishedAt !== undefined;

  const nodes: Node[] = [
    el("p", "import-name", job.workspaceName),
    el("p", "muted", finished
      ? `${status.done} of ${status.total} page${status.total === 1 ? "" : "s"} imported${status.failed > 0 ? `, ${status.failed} failed` : ""}`
      : `Importing ${status.done + status.failed} of ${status.total}…`),
  ];

  if (job.error) nodes.push(el("p", "error", job.error));
  // Only the first few reasons: a chapter whose CDN is refusing everything would otherwise fill the popup
  for (const page of job.pages.filter((candidate) => candidate.state === "failed").slice(0, 3)) {
    nodes.push(el("p", "error", `Page ${page.index + 1}: ${page.reason ?? "failed"}`));
  }

  const { serverUrl } = await loadServerAccess();
  if (serverUrl) {
    const open = el("a", "menu-btn", "Open the workspace") as HTMLAnchorElement;
    open.href = `${serverUrl}/studio/w/${job.workspaceId}`;
    open.target = "_blank";
    open.rel = "noreferrer";
    nodes.push(open);
  }

  if (finished) {
    const done = el("button", "menu-btn", "Done");
    done.addEventListener("click", () => {
      void send({ type: "clear-import" }).then(() => void start());
    });
    nodes.push(done);
  }

  show(...nodes);
}

/** Follows a running import until it ends; the popup may be closed at any point, which stops nothing. */
function pollProgress(): void {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void send<ImportStatusReply>({ type: "import-status" }).then((status) => {
      if (!status?.job) {
        window.clearInterval(pollTimer);
        void start();
        return;
      }
      void renderProgress(status);
      if (status.job.finishedAt !== undefined) window.clearInterval(pollTimer);
    });
  }, POLL_MS);
}

// ── What the page holds ──────────────────────────────────────────────────────

function renderFound(found: Extract<ChapterExtractResult, { ok: true }>, sourceUrl: string, earlier: WorkspaceRef | null): void {
  const chosen = new Set(found.images);
  const suggested = [found.title, found.chapter ? `Chapter ${found.chapter}` : null].filter(Boolean).join(" — ");

  const header = el("p", "import-found", `Found ${found.images.length} page${found.images.length === 1 ? "" : "s"} · ${found.label}`);

  const name = el("input", "import-input") as HTMLInputElement;
  name.value = (suggested || "Imported chapter").slice(0, 200);
  name.maxLength = 200;
  name.setAttribute("aria-label", "Workspace name");

  const list = el("div", "import-list");
  found.images.slice(0, PREVIEW_ROWS).forEach((url, i) => {
    const row = el("label", "import-row");
    const tick = el("input") as HTMLInputElement;
    tick.type = "checkbox";
    tick.checked = true;
    tick.addEventListener("change", () => {
      if (tick.checked) chosen.add(url);
      else chosen.delete(url);
      header.textContent = `Found ${chosen.size} page${chosen.size === 1 ? "" : "s"} · ${found.label}`;
    });
    row.append(tick, el("span", "import-row-index", String(i + 1)), el("span", "import-row-url", url.split("/").pop() ?? url));
    list.append(row);
  });
  if (found.images.length > PREVIEW_ROWS) {
    list.append(el("p", "muted", `…and ${found.images.length - PREVIEW_ROWS} more`));
  }

  const translate = el("label", "import-option");
  const translateTick = el("input") as HTMLInputElement;
  translateTick.type = "checkbox";
  translateTick.checked = true;
  translate.append(translateTick, el("span", undefined, "Translate after import"));

  let addToEarlier: HTMLInputElement | null = null;
  const options: Node[] = [translate];
  if (earlier) {
    const reuse = el("label", "import-option");
    addToEarlier = el("input") as HTMLInputElement;
    addToEarlier.type = "checkbox";
    addToEarlier.checked = true;
    reuse.append(addToEarlier, el("span", undefined, `Add to “${earlier.name}” (${earlier.pages} pages)`));
    options.push(reuse);
  }

  const importButton = el("button", "menu-btn import-go", "Import chapter");
  importButton.addEventListener("click", () => {
    const images = found.images.filter((url) => chosen.has(url));
    if (images.length === 0) {
      message("Tick at least one page to import.", "error");
      return;
    }
    importButton.setAttribute("disabled", "true");
    const request: ImportRequest = {
      sourceUrl,
      provider: found.provider,
      minIntervalMs: found.minIntervalMs,
      images,
      name: name.value.trim() || "Imported chapter",
      runAfter: translateTick.checked,
      ...(found.adult !== undefined ? { adult: found.adult } : {}),
      ...(earlier && addToEarlier?.checked ? { workspaceId: earlier.id } : {}),
    };
    void send<{ ok: boolean; error?: string }>({ type: "start-chapter-import", request }).then((reply) => {
      if (!reply?.ok) {
        message(reply?.error ?? "the import didn't start", "error");
        return;
      }
      void send<ImportStatusReply>({ type: "import-status" }).then((status) => void renderProgress(status));
      pollProgress();
    });
  });

  const rescan = el("button", "link-btn", "Scan again");
  rescan.addEventListener("click", () => void start(true));

  show(header, name, list, ...options, importButton, rescan);
}

// ── Entry ────────────────────────────────────────────────────────────────────

/** Shows whichever of the three states applies: an import in flight, a find to confirm, or why neither is possible. */
export async function start(rescan = false): Promise<void> {
  window.clearInterval(pollTimer);
  try {
    const status = await send<ImportStatusReply>({ type: "import-status" });
    if (status?.job) {
      await renderProgress(status);
      if (status.job.finishedAt === undefined) pollProgress();
      return;
    }

    const tab = await activeTab();
    if (!tab?.id) {
      message("Open a chapter page to import it.");
      return;
    }

    message(rescan ? "Scanning the page…" : "Looking at this page…");
    const found = await chrome.tabs.sendMessage(tab.id, { type: "extract-chapter", rescan }) as ChapterExtractResult | undefined;
    if (!found) {
      // No content script here: a page loaded before the extension, or one it isn't allowed on
      message("This page can't be read — reload it and try again.");
      return;
    }
    if (!found.ok) {
      message(found.error, "error");
      return;
    }
    if (found.images.length === 0) {
      const none = el("p", "muted", "No chapter images found on this page.");
      const again = el("button", "link-btn", "Scan again");
      again.addEventListener("click", () => void start(true));
      show(none, again);
      return;
    }

    // An earlier import of this same address can be extended instead of duplicated; a server that can't be reached
    // just means the choice isn't offered
    const sourceUrl = tab.url ?? "";
    const access = await loadServerAccess();
    const earlier = access.serverUrl && access.apiKey
      ? await findWorkspaceBySource(access.serverUrl, access.apiKey, sourceUrl).catch(() => null)
      : null;
    renderFound(found, sourceUrl, earlier);
  } catch (err) {
    message(err instanceof Error ? err.message : String(err), "error");
  }
}
