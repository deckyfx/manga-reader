import { unzipSync } from "fflate";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/env";
import { childLogger } from "@/lib/logger";
import { kanaToRomaji } from "@/lib/romaji";

const log = childLogger("dict");

const ZIP_NAME = "jitendex-yomitan.zip";
const CACHE_NAME = "jitendex-index.json";
const MAX_GLOSSES = 6;
/** Jitendex tags priority (common) terms with ★ rather than JMdict's news1/ichi1 codes. */
const COMMON_TAG = "★";

export type DictMode = "local" | "jisho";

export interface Definition {
  word: string;
  reading: string;
  romaji: string;
  is_common: boolean;
  jlpt: string | null;
  glosses: string[];
  /** Same as `glosses`; the browser extension reads this name. */
  meanings: string[];
}

interface IndexEntry {
  reading: string;
  common: boolean;
  glosses: string[];
  score: number;
}

interface IndexCache {
  source: { size: number; mtimeMs: number };
  entries: Record<string, IndexEntry>;
}

/** Yomitan structured-content node — only the fields used for gloss extraction. */
type ContentNode = string | ContentNode[] | { content?: ContentNode; data?: { content?: string } } | null | undefined;

/** Yomitan term-bank row: [expression, reading, defTags, rules, score, definitions, sequence, termTags]. */
type TermRow = [string, string, string | null, string, number, ContentNode, number, string | null];

interface JishoResponse {
  data?: {
    is_common?: boolean;
    jlpt?: string[];
    japanese?: { word?: string; reading?: string }[];
    senses?: { english_definitions?: string[] }[];
  }[];
}

function toDefinition(word: string, reading: string, isCommon: boolean, jlpt: string | null, glosses: string[]): Definition {
  return { word, reading, romaji: kanaToRomaji(reading), is_common: isCommon, jlpt, glosses, meanings: glosses };
}

/** Plain text of a node, concatenated (used inside a single glossary item). */
function collectText(node: ContentNode, out: string[]): void {
  if (node == null) return;
  if (typeof node === "string") { out.push(node); return; }
  if (Array.isArray(node)) { for (const child of node) collectText(child, out); return; }
  collectText(node.content, out);
}

/** One gloss per sense: the `<li>` items of each `glossary` list joined with "; ". Skips POS labels and attribution. */
function collectGlossaries(node: ContentNode, out: string[]): void {
  if (node == null || typeof node === "string") return;
  if (Array.isArray(node)) { for (const child of node) collectGlossaries(child, out); return; }
  if (node.data?.content === "glossary") {
    const items = (Array.isArray(node.content) ? node.content : [node.content])
      .map((li) => { const parts: string[] = []; collectText(li, parts); return parts.join("").trim(); })
      .filter(Boolean);
    if (items.length > 0) out.push(items.join("; "));
    return;
  }
  collectGlossaries(node.content, out);
}

async function fetchJisho(word: string): Promise<Definition | null> {
  try {
    const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`, {
      headers: { "User-Agent": "web-ocr-bun" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const first = ((await res.json()) as JishoResponse).data?.[0];
    if (!first) return null;
    const glosses = (first.senses ?? []).flatMap((s) => s.english_definitions ?? []).slice(0, MAX_GLOSSES);
    if (glosses.length === 0) return null;
    const jp = first.japanese?.[0];
    return toDefinition(jp?.word ?? word, jp?.reading ?? "", first.is_common === true, first.jlpt?.[0] ?? null, glosses);
  } catch (err) {
    log.warn({ err, word }, "Jisho lookup failed");
    return null;
  }
}

/** Offline Jitendex lookups with a Jisho API fallback. The parsed index is cached next to the zip. */
class DictionaryService {
  private index = new Map<string, IndexEntry>();

  async init(): Promise<void> {
    const dir = env.DICT_DIR;
    const zipPath = join(dir, ZIP_NAME);
    const cachePath = join(dir, CACHE_NAME);
    if (!existsSync(zipPath)) throw new Error(`${ZIP_NAME} not found in ${dir}`);
    const { size, mtimeMs } = statSync(zipPath);

    const cacheFile = Bun.file(cachePath);
    if (await cacheFile.exists()) {
      try {
        const cache = (await cacheFile.json()) as IndexCache;
        if (cache.source.size === size && cache.source.mtimeMs === mtimeMs) {
          this.index = new Map(Object.entries(cache.entries));
          log.info(`Loaded ${this.index.size} expressions from index cache.`);
          return;
        }
        log.info("Jitendex zip changed — rebuilding index.");
      } catch (err) {
        log.warn({ err }, "Index cache unreadable — rebuilding");
      }
    }

    const start = Date.now();
    this.index = await this.buildIndex(zipPath);
    const cache: IndexCache = { source: { size, mtimeMs }, entries: Object.fromEntries(this.index) };
    await Bun.write(cachePath, JSON.stringify(cache));
    log.info(`Indexed ${this.index.size} expressions in ${Date.now() - start}ms.`);
  }

  private async buildIndex(zipPath: string): Promise<Map<string, IndexEntry>> {
    const zip = await Bun.file(zipPath).bytes();

    // List term banks without inflating, then inflate one at a time to cap peak memory.
    const names: string[] = [];
    unzipSync(zip, { filter: (f) => { if (/^term_bank_\d+\.json$/.test(f.name)) names.push(f.name); return false; } });
    if (names.length === 0) throw new Error(`No term_bank_*.json files in ${zipPath}`);

    const decoder = new TextDecoder();
    const index = new Map<string, IndexEntry>();
    for (const name of names) {
      const rows = JSON.parse(decoder.decode(unzipSync(zip, { filter: (f) => f.name === name })[name])) as TermRow[];
      for (const [expression, reading, defTags, , rawScore, definitions, , termTags] of rows) {
        if (!expression) continue;
        const score = typeof rawScore === "number" ? rawScore : 0;
        const prev = index.get(expression);
        if (prev && prev.score >= score) continue;

        const glosses: string[] = [];
        collectGlossaries(definitions, glosses);
        if (glosses.length === 0) continue;

        const tags = `${defTags ?? ""} ${termTags ?? ""}`.split(" ");
        index.set(expression, { reading, common: tags.includes(COMMON_TAG), glosses: glosses.slice(0, MAX_GLOSSES), score });
      }
    }
    return index;
  }

  /** Local index first; Jisho when `mode` is "jisho" or no local index is loaded. */
  async lookup(word: string, mode: DictMode): Promise<Definition | null> {
    if (!word.trim()) return null;
    const hit = this.index.get(word);
    if (hit) return toDefinition(word, hit.reading, hit.common, null, hit.glosses);
    if (mode === "jisho" || this.index.size === 0) return fetchJisho(word);
    return null;
  }
}

export const dictionaryService = new DictionaryService();
