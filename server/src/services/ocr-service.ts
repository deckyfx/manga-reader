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

export async function loadOcrModel(dir: string = env.OCR_MODELS_DIR): Promise<void> {
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

  const sharp = (await import("@/lib/sharp")).default;
  const SIZE = 224;

  if (env.OCR_DEBUG) {
    mkdirSync(DEBUG_DIR, { recursive: true });
    await sharp(imageBuffer).png().toFile(`${DEBUG_DIR}/${tag}_raw.png`);
  }

  // Mirrors C# OcrEngine: grayscale → invert dark backgrounds → fit inside 224² keeping
  // aspect ratio → centre on white. A plain square resize crops tall bubbles and drops characters.
  const gray = await sharp(imageBuffer)
    .flatten({ background: "#ffffff" })
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (gray.info.channels !== 1) throw new Error(`Expected 1 channel, got ${gray.info.channels}`);

  let brightness = 0;
  for (let i = 0; i < gray.data.length; i++) brightness += gray.data[i];

  let pipeline = sharp(gray.data, { raw: { width: gray.info.width, height: gray.info.height, channels: 1 } });
  if (brightness / gray.data.length < 127) pipeline = pipeline.negate();

  const { data, info } = await pipeline
    .resize(SIZE, SIZE, { fit: "contain", background: "#ffffff", kernel: "mitchell" })
    .removeAlpha()
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== SIZE || info.height !== SIZE) {
    throw new Error(`Unexpected preprocessed shape ${info.width}x${info.height}x${info.channels}`);
  }

  // Normalise to [-1, 1] and replicate the gray plane into all 3 CHW channels
  const plane = SIZE * SIZE;
  const float32 = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const v = data[i] / 127.5 - 1;
    float32[i] = v;
    float32[i + plane] = v;
    float32[i + 2 * plane] = v;
  }

  const pixelTensor = new ort.Tensor("float32", float32, [1, 3, SIZE, SIZE]);

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
    // Exact pixels fed to the encoder
    await sharp(data, { raw: { width: SIZE, height: SIZE, channels: 1 } })
      .png()
      .toFile(`${DEBUG_DIR}/${tag}_224x224.png`);
    log.debug({ tag, tokens: decoded, text }, `OCR debug — "${text}"`);
  }

  return { text, processingTimeMs: Date.now() - start };
}
