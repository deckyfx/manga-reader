import * as ort from "onnxruntime-node";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { env } from "@/env";
import { inferenceHandlers } from "@/queue/inference-queue";
import { bootState } from "@/boot-state";
import { runtimeSettings } from "@/stores/settings-store";
import { childLogger } from "@/lib/logger";

const log = childLogger("translate");

export interface TranslateInput {
  text: string;
  engine?: string;
  sourceLang?: string;
  targetLang?: string;
}

export interface TranslateOutput {
  translatedText: string;
  engine: "local" | "deepl";
  processingTimeMs: number;
}

interface Tokenizer {
  encode: (text: string) => number[];
  decode: (ids: number[]) => string;
}

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let tokenizer: Tokenizer | null = null;
let modelBosToken = 0;
let modelEosToken = 0;

export async function loadTranslateModel(): Promise<void> {
  const dir = env.TRANSLATE_MODELS_DIR;
  // Support both flat layout (C# server downloads) and Xenova onnx/ subdir layout.
  const encoderPath = existsSync(join(dir, "onnx/encoder_model.onnx"))
    ? join(dir, "onnx/encoder_model.onnx")
    : join(dir, "encoder_model.onnx");
  const decoderPath = existsSync(join(dir, "onnx/decoder_model.onnx"))
    ? join(dir, "onnx/decoder_model.onnx")
    : join(dir, "decoder_model.onnx");
  const tokenizerPath = join(dir, "tokenizer.json");

  if (!existsSync(encoderPath) || !existsSync(decoderPath) || !existsSync(tokenizerPath)) {
    throw new Error(`Translate model files not found in ${dir}.`);
  }

  encoderSession = await ort.InferenceSession.create(encoderPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  decoderSession = await ort.InferenceSession.create(decoderPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });

  // Load tokenizer.json — also extract BOS/EOS token IDs from added_tokens so
  // config.json is not required (MarianMT: EOS = </s> id, BOS = <pad> id).
  const tokenizerJson = JSON.parse(readFileSync(tokenizerPath, "utf8")) as Record<string, unknown>;
  tokenizer = buildTokenizer(tokenizerJson);

  const addedTokens = (tokenizerJson["added_tokens"] as { id: number; content: string }[] | undefined) ?? [];
  const eosEntry = addedTokens.find((t) => t.content === "</s>");
  const bosEntry = addedTokens.find((t) => t.content === "<pad>");

  // Fall back to config.json only when tokenizer.json doesn't carry the special token IDs.
  const configPath = join(dir, "config.json");
  if (eosEntry !== undefined && bosEntry !== undefined) {
    modelEosToken = eosEntry.id;
    modelBosToken = bosEntry.id;
  } else if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    if (typeof cfg["decoder_start_token_id"] !== "number" || typeof cfg["eos_token_id"] !== "number") {
      throw new Error(`Translate model config.json is missing decoder_start_token_id or eos_token_id.`);
    }
    modelBosToken = cfg["decoder_start_token_id"];
    modelEosToken = cfg["eos_token_id"];
  } else {
    throw new Error(
      `Cannot determine BOS/EOS token IDs: tokenizer.json has no <pad>/<s> in added_tokens and config.json not found in ${dir}.`
    );
  }

  inferenceHandlers.translate = runTranslate as (input: unknown, signal: AbortSignal) => Promise<unknown>;
  bootState.translateReady = true;
  log.info(`Translate model loaded (BOS=${modelBosToken}, EOS=${modelEosToken})`);
}

async function runTranslate(input: unknown, signal?: AbortSignal): Promise<TranslateOutput> {
  if (!input || typeof input !== "object" || typeof (input as TranslateInput).text !== "string") {
    throw new Error("Invalid translate input: text must be a string");
  }
  const { text, engine, targetLang = "en" } = input as TranslateInput;

  // Resolve which engine to use: explicit request → runtime setting → env default.
  const resolved = engine === "deepl" || engine === "local"
    ? engine
    : runtimeSettings.preferredTranslationEngine !== "local" && env.DEEPL_API_KEY
      ? "deepl"
      : "local";

  if (resolved === "deepl") {
    if (!env.DEEPL_API_KEY) throw new Error("DeepL API key not configured");
    return runDeepL(text, targetLang);
  }

  if (!encoderSession || !decoderSession || !tokenizer) {
    throw new Error("Translate model not loaded");
  }

  const start = Date.now();

  const MAX_INPUT_LEN = 512;
  // Pre-check raw text length before BPE: ≈ MAX_INPUT_LEN × 4 chars is a safe upper bound.
  if (text.length > MAX_INPUT_LEN * 4)
    throw new Error(`Input too long: ${text.length} chars exceeds the ~${MAX_INPUT_LEN}-token limit`);
  const inputIds = tokenizer.encode(text);
  if (inputIds.length > MAX_INPUT_LEN)
    throw new Error(`Input too long: ${inputIds.length} tokens exceeds the ${MAX_INPUT_LEN}-token limit`);
  const idsTensor = new ort.Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);
  const attentionMask = new ort.Tensor("int64", BigInt64Array.from(inputIds.map(() => 1n)), [1, inputIds.length]);

  const encOut = await encoderSession.run({
    input_ids: idsTensor,
    attention_mask: attentionMask,
  });
  const encoderHidden = encOut["last_hidden_state"];

  // Greedy decode — use model config tokens (e.g. Xenova/opus-mt-ja-en: BOS=60715, EOS=0).
  const BOS = modelBosToken;
  const EOS = modelEosToken;
  const MAX_LEN = 512;
  let genIds = [BOS];

  for (let step = 0; step < MAX_LEN; step++) {
    if (signal?.aborted) throw new Error("Inference aborted (timeout)");
    const genTensor = new ort.Tensor("int64", BigInt64Array.from(genIds.map(BigInt)), [1, genIds.length]);
    const decOut = await decoderSession.run({
      input_ids: genTensor,
      encoder_hidden_states: encoderHidden,
      encoder_attention_mask: attentionMask,
    });
    const logits = decOut["logits"]?.data as Float32Array | undefined;
    if (!logits) throw new Error("Translate decoder produced no logits");
    const seqLen = genIds.length;
    const vocabSize = logits.length / seqLen;
    const lastLogits = logits.slice((seqLen - 1) * vocabSize, seqLen * vocabSize);
    let maxIdx = 0, maxVal = -Infinity;
    for (let j = 0; j < lastLogits.length; j++) {
      if (lastLogits[j] > maxVal) { maxVal = lastLogits[j]; maxIdx = j; }
    }
    if (maxIdx === EOS && step > 0) break;
    genIds.push(maxIdx);
  }

  const translatedText = tokenizer.decode(genIds.slice(1));
  return { translatedText, engine: "local", processingTimeMs: Date.now() - start };
}

async function runDeepL(text: string, targetLang: string): Promise<TranslateOutput> {
  const start = Date.now();
  const key = env.DEEPL_API_KEY ?? "";
  // Free-tier keys end with :fx; paid keys use api.deepl.com
  const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const res = await fetch(`https://${host}/v2/translate`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Authorization": `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: [text], target_lang: targetLang.toUpperCase() }),
  });
  if (!res.ok) {
    const status = res.status;
    await res.body?.cancel();
    throw new Error(`DeepL HTTP ${status}`);
  }
  const json = await res.json() as { translations?: { text: string }[] };
  const first = json.translations?.[0];
  if (!first?.text) throw new Error("DeepL returned no translations");
  return {
    translatedText: first.text,
    engine: "deepl",
    processingTimeMs: Date.now() - start,
  };
}

/**
 * Build a tokenizer from a HuggingFace tokenizer.json.
 * Supports both BPE (model.type == "BPE", has model.merges) and
 * Unigram/SentencePiece (model.type == "Unigram", used by opus-mt-* MarianMT models).
 */
function buildTokenizer(json: Record<string, unknown>): Tokenizer {
  const model = json["model"] as Record<string, unknown>;
  const modelType = (model["type"] as string | undefined)?.toLowerCase();

  if (modelType === "unigram") {
    return buildUnigramTokenizer(model);
  }
  return buildBpeTokenizer(model);
}

/** Unigram (Viterbi / SentencePiece) tokenizer — used by MarianMT opus-mt-* models. */
function buildUnigramTokenizer(model: Record<string, unknown>): Tokenizer {
  // vocab is [[token, logprob], ...] ordered by token id
  const vocabArr = model["vocab"] as [string, number][];
  const unkId = (model["unk_id"] as number | undefined) ?? 0;
  const MAX_TOK_LEN = 16;
  const UNK_PENALTY = -100;
  const SPACE = "▁";

  const idToToken: string[] = vocabArr.map(([tok]) => tok);
  const scores: number[] = vocabArr.map(([, s]) => s);
  const tokenToId = new Map<string, number>();
  for (let i = 0; i < idToToken.length; i++) {
    if (!tokenToId.has(idToToken[i])) tokenToId.set(idToToken[i], i);
  }

  function viterbi(s: string): number[] {
    const n = s.length;
    const dp = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1);
    const tl = new Int32Array(n + 1);
    dp[0] = 0;

    for (let i = 0; i < n; i++) {
      if (dp[i] === -Infinity) continue;
      const maxLen = Math.min(MAX_TOK_LEN, n - i);
      for (let len = 1; len <= maxLen; len++) {
        const tok = s.slice(i, i + len);
        let tokScore: number;
        if (tokenToId.has(tok)) {
          tokScore = scores[tokenToId.get(tok)!];
        } else if (len === 1) {
          tokScore = UNK_PENALTY;
        } else {
          continue;
        }
        const cand = dp[i] + tokScore;
        const end = i + len;
        if (cand > dp[end]) {
          dp[end] = cand;
          from[end] = i;
          tl[end] = len;
        }
      }
    }

    const ids: number[] = [];
    let pos = n;
    while (pos > 0) {
      const start = from[pos];
      const tok = s.slice(start, pos);
      ids.push(tokenToId.has(tok) ? tokenToId.get(tok)! : unkId);
      pos = start;
    }
    ids.reverse();
    return ids;
  }

  return {
    encode(text: string): number[] {
      // Normalise whitespace to ▁, prepend ▁ for sentence start (Metaspace convention)
      const normalised = SPACE + text.replace(/\s+/g, SPACE);
      return viterbi(normalised);
    },
    decode(ids: number[]): string {
      return ids
        .map((id) => idToToken[id] ?? "")
        .join("")
        .replace(/▁/g, " ")
        .trimStart();
    },
  };
}

/** BPE tokenizer — used by models with model.type == "BPE" and a merges list. */
function buildBpeTokenizer(model: Record<string, unknown>): Tokenizer {
  const vocabMap = model["vocab"] as Record<string, number>;
  const idToToken = Object.fromEntries(Object.entries(vocabMap).map(([t, id]) => [id, t]));
  const mergeRank = new Map<string, number>(
    (model["merges"] as string[]).map((m, i) => [m, i]),
  );

  function applyBpe(word: string): string[] {
    let parts = word.split("");
    while (parts.length > 1) {
      let bestRank = Infinity;
      let bestIdx = -1;
      for (let i = 0; i < parts.length - 1; i++) {
        const rank = mergeRank.get(`${parts[i]} ${parts[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      parts = [...parts.slice(0, bestIdx), parts[bestIdx] + parts[bestIdx + 1], ...parts.slice(bestIdx + 2)];
    }
    return parts;
  }

  const unkId = vocabMap["<unk>"] ?? 0;

  return {
    encode(text: string): number[] {
      const tokens: number[] = [];
      for (const word of text.split(" ")) {
        const bpeTokens = applyBpe("▁" + word);
        for (const t of bpeTokens) tokens.push(vocabMap[t] ?? unkId);
      }
      return tokens;
    },
    decode(ids: number[]): string {
      return ids
        .map((id) => idToToken[id] ?? "")
        .join("")
        .replace(/▁/g, " ")
        .trim();
    },
  };
}
