import * as kuromoji from "@patdx/kuromoji";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/env";
import { childLogger } from "@/lib/logger";
import { kanaToRomaji } from "@/lib/romaji";

const log = childLogger("analyze");

/** Gzipped IPADIC files kuromoji needs; downloaded at boot so the compiled binary stays self-contained. */
export const KUROMOJI_DICT_FILES = [
  "base.dat.gz", "cc.dat.gz", "check.dat.gz", "tid.dat.gz", "tid_map.dat.gz", "tid_pos.dat.gz",
  "unk.dat.gz", "unk_char.dat.gz", "unk_compat.dat.gz", "unk_invoke.dat.gz", "unk_map.dat.gz", "unk_pos.dat.gz",
] as const;

/** Parts of speech that never get a dictionary lookup (particles, auxiliaries, symbols, …). */
const SKIP_POS = new Set(["助詞", "助動詞", "記号", "補助記号", "接続詞", "感動詞"]);

export interface TokenInfo {
  surface: string;
  pos: string;
  pos_detail: string;
  conjugation_type: string;
  conjugation_form: string;
  dictionary_form: string;
  reading: string;
  romaji: string;
  is_unknown: boolean;
}

type Tokenizer = Awaited<ReturnType<kuromoji.TokenizerBuilder["build"]>>;

/** Japanese morphological analysis with kuromoji (IPADIC — same tagset as the C# NMeCab service). */
class AnalyzeService {
  private tokenizer: Tokenizer | null = null;

  async load(): Promise<void> {
    const dir = env.KUROMOJI_DICT_DIR;
    const missing = KUROMOJI_DICT_FILES.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) throw new Error(`Kuromoji dictionary files missing in ${dir}: ${missing.join(", ")}`);

    const loader = {
      async loadArrayBuffer(file: string): Promise<ArrayBuffer> {
        const bytes = Bun.gunzipSync(await Bun.file(join(dir, file)).bytes());
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    };
    this.tokenizer = await new kuromoji.TokenizerBuilder({ loader }).build();
    log.info("Tokenizer loaded.");
  }

  shouldSkip(pos: string): boolean {
    return SKIP_POS.has(pos);
  }

  tokenize(text: string): TokenInfo[] {
    if (!this.tokenizer) throw new Error("Tokenizer not loaded");
    return this.tokenizer.tokenize(text).map((t) => {
      const reading = t.reading && t.reading !== "*" ? t.reading : t.surface_form;
      return {
        surface: t.surface_form,
        pos: t.pos || "*",
        pos_detail: t.pos_detail_1 || "*",
        conjugation_type: t.conjugated_type || "*",
        conjugation_form: t.conjugated_form || "*",
        dictionary_form: t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form,
        reading,
        romaji: kanaToRomaji(reading),
        is_unknown: t.word_type === "UNKNOWN",
      };
    });
  }
}

export const analyzeService = new AnalyzeService();
