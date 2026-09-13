import * as ort from "onnxruntime-node";
import { readFileSync } from "fs";
import { join } from "path";
import { env } from "@/env";
import { inferenceHandlers } from "@/queue/inference-queue";
import { bootState } from "@/boot-state";
import { childLogger } from "@/lib/logger";
import { mkdirSync } from "node:fs";

const log = childLogger("ocr");
const DEBUG_DIR = "./data/debug/ocr";

export interface OcrInput {
  /** Raw image bytes (JPEG/PNG) */
  imageBuffer: Buffer;
}

export interface OcrOutput {
  text: string;
  processingTimeMs: number;
}

/** manga-ocr-onnx encoder/decoder sessions */
let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let vocab: string[] = [];

export async function loadOcrModel(): Promise<void> {
  const dir = env.OCR_MODELS_DIR;
  const encoderPath = join(dir, "encoder_model.onnx");
  const decoderPath = join(dir, "decoder_model.onnx");
  const vocabPath = join(dir, "vocab.txt");

  // Validate files exist before loading sessions
  const { existsSync } = await import("fs");
  if (!existsSync(encoderPath) || !existsSync(decoderPath) || !existsSync(vocabPath)) {
    throw new Error(`OCR model files not found in ${dir}. Run model download first.`);
  }

  encoderSession = await ort.InferenceSession.create(encoderPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  decoderSession = await ort.InferenceSession.create(decoderPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });

  vocab = readFileSync(vocabPath, "utf8").split("\n").map((l) => l.trim());

  inferenceHandlers.ocr = runOcr as (input: unknown, signal: AbortSignal) => Promise<unknown>;
  bootState.ocrReady = true;
  log.info("OCR model loaded.");
}

async function runOcr(input: unknown, signal?: AbortSignal): Promise<OcrOutput> {
  const { imageBuffer } = input as OcrInput;
  if (!encoderSession || !decoderSession) throw new Error("OCR model not loaded");
  if (signal?.aborted) throw new Error("Inference aborted (timeout)");

  const start = Date.now();
  const tag = start.toString(36); // short unique tag per request

  // Pre-process: resize to 224×224, normalise to [-1, 1] float32
  const sharp = (await import("sharp")).default;

  if (env.OCR_DEBUG) {
    mkdirSync(DEBUG_DIR, { recursive: true });
    // Save raw input
    await sharp(imageBuffer).png().toFile(`${DEBUG_DIR}/${tag}_raw.png`);
  }

  const { data, info } = await sharp(imageBuffer)
    .resize(224, 224)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) throw new Error(`Expected 3 channels, got ${info.channels}`);

  const float32 = new Float32Array(3 * 224 * 224);
  for (let i = 0; i < 224 * 224; i++) {
    float32[i]               = (data[i * 3]     / 127.5) - 1;      // R
    float32[i + 224 * 224]   = (data[i * 3 + 1] / 127.5) - 1;      // G
    float32[i + 2 * 224 * 224] = (data[i * 3 + 2] / 127.5) - 1;    // B
  }

  const pixelTensor = new ort.Tensor("float32", float32, [1, 3, 224, 224]);

  // Encoder
  const encOut = await encoderSession.run({ pixel_values: pixelTensor });
  const encoderHidden = encOut["last_hidden_state"];

  // Greedy decoder — mirrors C# MangaOcrService
  // vocab[0]=PAD, [1]=UNK, [2]=CLS, [3]=SEP/EOS, [4]=MASK
  const BOS_TOKEN = 2;  // [CLS] — used as decoder start token
  const EOS_TOKEN = 3;  // [SEP] — signals end of sequence
  const SPECIAL_TOKENS = new Set([0, 1, 2, 3, 4]); // skip PAD/UNK/CLS/SEP/MASK in output
  const MAX_LEN = 300;
  let inputIds = [BOS_TOKEN];
  const decoded: number[] = [];

  for (let step = 0; step < MAX_LEN; step++) {
    if (signal?.aborted) throw new Error("Inference aborted (timeout)");
    const idsTensor = new ort.Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);
    const decOut = await decoderSession.run({
      input_ids: idsTensor,
      encoder_hidden_states: encoderHidden,
    });
    const logits = decOut["logits"].data as Float32Array;
    const seqLen = inputIds.length;
    const vocabSize = logits.length / seqLen;
    // Take the last token's logits
    const lastLogits = logits.slice((seqLen - 1) * vocabSize, seqLen * vocabSize);
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let j = 0; j < lastLogits.length; j++) {
      if (lastLogits[j] > maxVal) { maxVal = lastLogits[j]; maxIdx = j; }
    }
    if (maxIdx === EOS_TOKEN) break;
    if (!SPECIAL_TOKENS.has(maxIdx)) decoded.push(maxIdx);
    inputIds.push(maxIdx);
  }

  // SentencePiece vocab: "▁" marks word boundaries (space before word)
  const text = decoded
    .map((id) => vocab[id] ?? "")
    .join("")
    .replace(/▁/g, " ")
    .trim();

  if (env.OCR_DEBUG) {
    // Save the 224×224 image the model actually saw (reconstructed from float32 data)
    const uint8 = Buffer.from(float32.map((v) => Math.round((v + 1) * 127.5)));
    await sharp(uint8, { raw: { width: 224, height: 224, channels: 3 } })
      .png()
      .toFile(`${DEBUG_DIR}/${tag}_224x224.png`);
    log.debug({ tag, tokens: decoded, text }, `OCR debug — "${text}"`);
  }

  return { text, processingTimeMs: Date.now() - start };
}
