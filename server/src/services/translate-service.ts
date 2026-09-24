import * as ort from "onnxruntime-node";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { env } from "@/env";
import { inferenceHandlers } from "@/queue/inference-queue";
import { bootState } from "@/boot-state";
import { resolveTranslationEngine } from "@/services/translation-engine";
import { childLogger } from "@/lib/logger";
import { retryAfterMs, Transient, withRetry } from "@/lib/retry";

const log = childLogger("translate");

export interface TranslateInput {
  text: string;
  engine?: string;
  sourceLang?: string;
  targetLang?: string;
}

export interface TranslateOutput {
  translatedText: string;
  engine: "local" | "deepl" | "sugoi";
  processingTimeMs: number;
}

/** Several texts translated in one go, in the order they were given. */
export interface TranslateManyOutput {
  translations: string[];
  engine: "local" | "deepl" | "sugoi";
  processingTimeMs: number;
}

/**
 * How many texts this server's engine will take in one request.
 *
 * A remote engine spends its time on the round trip, not the translating — a page's blocks sent one at a time cost
 * one wait each, and the machine sits idle through all of them. Sent together they cost one wait. The built-in
 * model has no round trip and no batching in its session, so it stays at one and keeps its per-block progress.
 */
export function translationBatchSize(): number {
  switch (resolveTranslationEngine()) {
    case "deepl": return 50; // the API's own limit per request
    case "sugoi": return 64; // tools/sugoi caps a request at 128 sentences
    default: return 1;
  }
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

  registerTranslateHandler();
  bootState.translateReady = true;
  log.info(`Translate model loaded (BOS=${modelBosToken}, EOS=${modelEosToken})`);
}

/**
 * Takes translation jobs. Called at boot whatever the local model does: DeepL and Sugoi translate without it, and
 * only this handler can reach them.
 */
export function registerTranslateHandler(): void {
  inferenceHandlers.translate = runTranslate as (input: unknown, signal: AbortSignal) => Promise<unknown>;
}

async function runTranslate(input: unknown, signal?: AbortSignal): Promise<TranslateOutput | TranslateManyOutput> {
  if (!input || typeof input !== "object") throw new Error("Invalid translate input");
  const asked = input as TranslateInput & { texts?: unknown };
  // One text or several: a caller with several gets them back in the same order, and pays one round trip
  const many = Array.isArray(asked.texts);
  if (!many && typeof asked.text !== "string") throw new Error("Invalid translate input: text must be a string");
  if (many && !(asked.texts as unknown[]).every((t) => typeof t === "string"))
    throw new Error("Invalid translate input: texts must be strings");
  const texts = many ? (asked.texts as string[]) : [asked.text];
  const { engine, targetLang = "en" } = asked;
  const one = (result: TranslateManyOutput): TranslateOutput | TranslateManyOutput =>
    many ? result : { translatedText: result.translations[0] ?? "", engine: result.engine, processingTimeMs: result.processingTimeMs };

  const resolved = resolveTranslationEngine(engine);
  if (resolved === "sugoi") return one(await runSugoi(texts, signal));
  if (resolved === "deepl") return one(await runDeepL(texts, targetLang, signal));

  if (!encoderSession || !decoderSession || !tokenizer) {
    throw new Error("No translator available: the built-in model isn't loaded, and no DeepL key or Sugoi server is set");
  }
  const localStart = Date.now();
  const translations: string[] = [];
  // One at a time: the session takes one sequence, and there is no round trip to save by grouping them
  for (const each of texts) translations.push(await runLocal(each, signal));
  return one({ translations, engine: "local", processingTimeMs: Date.now() - localStart });
}

/** The built-in model, one text at a time. */
async function runLocal(text: string, signal?: AbortSignal): Promise<string> {
  if (!encoderSession || !decoderSession || !tokenizer) throw new Error("Translate model not loaded");

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

  return tokenizer.decode(genIds.slice(1));
}

/**
 * A self-hosted Sugoi server (the Sugoi Toolkit's own, or the one in tools/sugoi/). It speaks the format Sugoi
 * clients use: `{ content, message: "translate sentences" }`, answering with the translation — a string, or a
 * one-item list when asked with a list. Japanese to English only, so the target language is not its business.
 */
/**
 * The request's own deadline, and the queue's if it has one: a job the queue has given up on should stop waiting
 * for an answer nobody will read, rather than holding its turn until its own timeout runs out.
 */
function until(ms: number, signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

async function runSugoi(texts: string[], signal?: AbortSignal): Promise<TranslateManyOutput> {
  const start = Date.now();
  const translations: string[] = [];
  // A list at a time, as its own clients send: the waiting is what costs, not the translating
  for (const batch of chunk(texts, 64)) {
    const got = await withRetry(async () => {
      let response: Response;
      try {
        response = await fetch(env.SUGOI_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // One text goes as a string, as every Sugoi client has always sent it: a server that only understands
          // that form keeps working, and the list form is used only when there is something to gain by it
          body: JSON.stringify({ content: batch.length === 1 ? batch[0] : batch, message: "translate sentences" }),
          signal: until(env.SUGOI_TIMEOUT_MS, signal),
        });
      } catch (err) {
        // The caller giving up is not the server's failure, and must not be tried again
        if (signal?.aborted) throw err;
        // A refused connection or a request that ran out of time: a container still loading its model looks
        // exactly like this, and looks nothing like it a moment later
        throw new Transient(`Sugoi server unreachable at ${env.SUGOI_URL}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (response.status === 429 || response.status >= 500) {
        const status = response.status;
        const after = retryAfterMs(response.headers.get("retry-after"));
        await response.body?.cancel();
        throw new Transient(`Sugoi server answered ${status}`, after);
      }
      if (!response.ok) throw new Error(`Sugoi server answered ${response.status}`);
      const answer: unknown = await readBody(response, signal);
      // A list back for a list, but a server asked for one sentence may answer with the string itself
      const texts = typeof answer === "string" ? [answer] : Array.isArray(answer) && answer.every((t) => typeof t === "string") ? answer as string[] : null;
      // Not transient: the same request would be answered the same way, and the fault is worth seeing
      if (texts === null) throw new Error("Sugoi server answered in a shape this doesn't understand");
      if (texts.length !== batch.length) throw new Error(`Sugoi server answered with ${texts.length} translations for ${batch.length} texts`);
      return texts;
    }, { signal, onRetry: ({ attempt, waitMs, reason }) => log.warn({ attempt, waitMs }, `Sugoi: ${reason} — trying again`) });
    translations.push(...got);
  }
  return { translations, engine: "sugoi", processingTimeMs: Date.now() - start };
}

/**
 * The answer's body, and what its failing means.
 *
 * A complete answer that isn't JSON is the server saying something nobody here understands — a proxy's error page,
 * usually — and asking again produces the same page, so it is a fault rather than weather.
 *
 * A body that dies halfway *would* be weather, but in Bun it never reaches here: a connection lost mid-body is
 * reported by `fetch` itself, and the catch around the request classifies it (measured, not assumed — a response
 * whose stream errors makes `fetch()` throw a TypeError, and `json()` is never reached). The branch stays as
 * defence for a runtime that behaves differently, and is deliberately not claimed to be under test.
 */
async function readBody(response: Response, signal?: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof SyntaxError) throw new Error(`answered with something that isn't JSON: ${err.message}`);
    throw new Transient(`the answer didn't arrive in full: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Splits into pieces of at most `size`; one empty piece is never returned. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const pieces: T[][] = [];
  for (let i = 0; i < items.length; i += size) pieces.push(items.slice(i, i + size));
  return pieces;
}

async function runDeepL(texts: string[], targetLang: string, signal?: AbortSignal): Promise<TranslateManyOutput> {
  const start = Date.now();
  const key = env.DEEPL_API_KEY ?? "";
  // Free-tier keys end with :fx; paid keys use api.deepl.com
  const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const translations: string[] = [];
  // Fifty at a time, which is the API's limit for one request
  for (const batch of chunk(texts, 50)) {
    const got = await withRetry(async () => {
      let res: Response;
      try {
        res = await fetch(`https://${host}/v2/translate`, {
          method: "POST",
          signal: until(15_000, signal),
          headers: {
            "Authorization": `DeepL-Auth-Key ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: batch, target_lang: targetLang.toUpperCase() }),
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new Transient(`DeepL unreachable: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (res.status === 429 || res.status >= 500) {
        const status = res.status;
        const after = retryAfterMs(res.headers.get("retry-after"));
        await res.body?.cancel();
        // 429 is DeepL asking to be left alone for a moment, and it usually says for how long
        throw new Transient(`DeepL HTTP ${status}`, after);
      }
      if (!res.ok) {
        const status = res.status;
        await res.body?.cancel();
        // A bad key, a quota spent (456), a text too long: all answered the same way however often it is asked
        throw new Error(`DeepL HTTP ${status}`);
      }
      const json = await readBody(res, signal) as { translations?: { text: string }[] };
      const answered = json.translations;
      // Position is the only thing tying a translation to the text it came from, so a short answer is an error
      if (!answered || answered.length !== batch.length) throw new Error(`DeepL answered with ${answered?.length ?? 0} translations for ${batch.length} texts`);
      return answered.map((t) => t.text);
    }, { signal, onRetry: ({ attempt, waitMs, reason }) => log.warn({ attempt, waitMs }, `DeepL: ${reason} — trying again`) });
    translations.push(...got);
  }
  return { translations, engine: "deepl", processingTimeMs: Date.now() - start };
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
