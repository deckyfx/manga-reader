/**
 * Downloads model files from HuggingFace (or any HTTPS URL) with:
 *  - streaming + atomic temp-file rename (no partial writes on disk)
 *  - console progress bar (matches C# ModelDownloader output)
 *  - skip if destination already exists
 *  - progress reported into BootState.downloadProgress for /health
 */

import { mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { bootState } from "@/boot-state";
import { childLogger } from "@/lib/logger";

const log = childLogger("download");

const HF_BASE = "https://huggingface.co";
const CHUNK = 65_536;

export interface DownloadEntry {
  /** HuggingFace repo slug, e.g. "mayocream/manga-ocr-onnx" */
  repo: string;
  /** Local directory to store files in */
  dir: string;
  /** Relative paths within the repo, e.g. ["onnx/encoder_model.onnx", "tokenizer.json"].
   *  Files are stored flat (basename only) inside `dir`. */
  files: string[];
  /** Human label for console output */
  label: string;
}

export interface DirectDownloadEntry {
  url: string;
  dest: string;
  label: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Download all files for a HuggingFace model entry. Skips existing files. */
export async function downloadHfModel(entry: DownloadEntry): Promise<void> {
  if (!entry.repo) return;
  mkdirSync(entry.dir, { recursive: true });

  for (const filePath of entry.files) {
    const url = `${HF_BASE}/${entry.repo}/resolve/main/${filePath}`;
    const dest = join(entry.dir, basename(filePath));
    await downloadFile(url, dest, `${entry.label}/${basename(filePath)}`);
  }
}

/** Download a single file from any HTTPS URL. Skips if dest already exists. */
export async function downloadFile(url: string, dest: string, label: string): Promise<void> {
  if (existsSync(dest)) {
    log.debug(`${label} already present — skipping`);
    return;
  }

  mkdirSync(dirname(dest), { recursive: true });

  log.info({ dest }, `Downloading ${label}`);

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  const tmp = `${dest}.${Math.random().toString(36).slice(2)}.tmp`;

  let done = 0;
  try {
    const writer = Bun.file(tmp).writer();
    const reader = res.body.getReader();
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      writer.write(value);
      done += value.byteLength;
      printProgress(label, done, total);
      bootState.setDownloadProgress(label, total > 0 ? Math.round((done / total) * 100) : -1);
    }
    await writer.end();
    process.stdout.write("\n");

    renameSync(tmp, dest);
    log.info(`${label} done (${formatBytes(total > 0 ? total : done)})`);
    bootState.setDownloadProgress(label, 100);
  } catch (err) {
    process.stdout.write("\n");
    try { unlinkSync(tmp); } catch { /* already gone */ }
    bootState.setDownloadProgress(label, -1);
    throw err;
  }
}

/** Print a download plan summary before starting downloads (like C# PrintDownloadPlan). */
export function printDownloadPlan(entries: DownloadEntry[]): void {
  const missing: string[] = [];
  for (const e of entries) {
    for (const f of e.files) {
      const dest = join(e.dir, basename(f));
      if (!existsSync(dest)) missing.push(`  ↓ ${e.label}/${basename(f)}`);
    }
  }
  if (missing.length === 0) return;
  log.info("Models to download:");
  for (const m of missing) log.info(m);
}

/**
 * Return the `browser_download_url` of the first `.zip` asset in the latest
 * release of a GitHub repo whose name contains `keyword` (case-insensitive).
 * Pass an empty string for `keyword` to return the first `.zip` unconditionally.
 */
export async function findGitHubReleaseAsset(owner: string, repo: string, keyword: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  const res = await fetch(url, {
    headers: { "Accept": "application/vnd.github+json", "User-Agent": "web-ocr-bun" },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`GitHub API ${res.status} for ${owner}/${repo}`);
  }
  const release = await res.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  const kw = keyword.toLowerCase();
  const asset = release.assets.find(
    (a) => a.name.toLowerCase().endsWith(".zip") && (!kw || a.name.toLowerCase().includes(kw)),
  );
  if (!asset) throw new Error(`No .zip asset${kw ? ` matching "${keyword}"` : ""} found in release ${release.tag_name} of ${owner}/${repo}`);
  log.info(`Found asset in release ${release.tag_name}: ${asset.name}`);
  return asset.browser_download_url;
}

// ── Internals ─────────────────────────────────────────────────────────────────

function printProgress(label: string, done: number, total: number): void {
  const BAR = 30;
  if (total > 0) {
    const pct = done / total;
    const filled = Math.round(pct * BAR);
    const bar = "█".repeat(filled) + "░".repeat(BAR - filled);
    process.stdout.write(`\r[Boot]   [${bar}] ${Math.round(pct * 100).toString().padStart(3)}%  ${formatBytes(done)} / ${formatBytes(total)}  `);
  } else {
    process.stdout.write(`\r[Boot]   ${formatBytes(done)} downloaded...  `);
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
