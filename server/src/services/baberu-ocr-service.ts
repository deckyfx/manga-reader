import * as ort from "onnxruntime-node";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/env";
import { bootState } from "@/boot-state";
import { inferenceHandlers } from "@/queue/inference-queue";
import { childLogger } from "@/lib/logger";
import type { OcrInput, OcrOutput } from "@/services/ocr-service";

const log = childLogger("ocr");
const DEBUG_DIR = "./data/debug/ocr";

// int4 vision: the published fp16 graph takes ~100 s per crop on onnxruntime-node CPU (no fast
// fp16 kernels); int4 weight-only runs in ~75 ms for +0.0026 nCER per the model's quantization notes.
const VISION_FILE = "vision_int4.onnx";
const PREFILL_FILE = "decoder_prefill_int8.onnx";
const STEP_FILE = "decoder_step_int8.onnx";
const VOCAB_FILE = "vocab.json";

// Mirrors onnx_infer.py from genshiai-daichi/baberu-ocr: ImageNet stats, greedy decode with published guards.
const SIZE = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const BOS = 1;
const EOS = 2;
const SPECIAL_IDS = 4;
const LAYERS = 6;
const MAX_NEW_TOKENS = 128;
const REPETITION_PENALTY = 1.2;
const MAX_CONTENT_RUN = 12;

function int64Scalar(value: number): ort.Tensor {
  return new ort.Tensor("int64", BigInt64Array.from([BigInt(value)]), [1, 1]);
}

/** Last-position logits as a mutable float64 copy. */
function lastLogits(tensor: ort.Tensor): Float64Array {
  const data = tensor.data as Float32Array;
  const vocabSize = tensor.dims[tensor.dims.length - 1];
  return Float64Array.from(data.subarray(data.length - vocabSize));
}

function argmax(values: Float64Array): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Baberu OCR (JA/ZH/EN): DINOv2 vision encoder + char-level decoder with KV cache (prefill, then one step per char). */
export class BaberuOcr {
  private constructor(
    private readonly vision: ort.InferenceSession,
    private readonly prefill: ort.InferenceSession,
    private readonly step: ort.InferenceSession,
    private readonly charset: string[],
    /** Letters/digits (not symbols or long-vowel marks); only these get the repeat-run cap. */
    private readonly contentIds: Set<number>,
  ) {}

  static async load(dir: string): Promise<BaberuOcr> {
    const missing = [VISION_FILE, PREFILL_FILE, STEP_FILE, VOCAB_FILE].filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) throw new Error(`Baberu OCR model files missing in ${dir}: ${missing.join(", ")}`);

    const options: ort.InferenceSession.SessionOptions = { executionProviders: ["cpu"], graphOptimizationLevel: "all" };
    const [vision, prefill, step] = await Promise.all(
      [VISION_FILE, PREFILL_FILE, STEP_FILE].map((f) => ort.InferenceSession.create(join(dir, f), options)),
    );
    const charset = (await Bun.file(join(dir, VOCAB_FILE)).json()) as string[];
    const contentIds = new Set<number>();
    charset.forEach((ch, i) => {
      if ([...ch].length === 1 && !"ーｰ〜~".includes(ch) && /^[\p{L}\p{N}]$/u.test(ch)) contentIds.add(i + SPECIAL_IDS);
    });
    return new BaberuOcr(vision, prefill, step, charset, contentIds);
  }

  /** RGB, stretch the whole crop to 224×224 (no aspect-preserving pad — matches training), ImageNet-normalise. */
  private async preprocess(image: Buffer, debugTag?: string): Promise<ort.Tensor> {
    const sharp = (await import("@/lib/sharp")).default;
    const { data, info } = await sharp(image)
      .removeAlpha()
      .toColourspace("srgb")
      .resize(SIZE, SIZE, { fit: "fill", kernel: "cubic" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`Expected 3 channels, got ${info.channels}`);

    if (debugTag) {
      mkdirSync(DEBUG_DIR, { recursive: true });
      await sharp(image).png().toFile(`${DEBUG_DIR}/${debugTag}_raw.png`);
      await sharp(data, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(`${DEBUG_DIR}/${debugTag}_224x224.png`);
    }

    const plane = SIZE * SIZE;
    const pixels = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) pixels[c * plane + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
    return new ort.Tensor("float32", pixels, [1, 3, SIZE, SIZE]);
  }

  /** Recognise the text in one bubble crop. `debugTag` saves the input and model-view images to data/debug/ocr. */
  async recognize(image: Buffer, signal?: AbortSignal, debugTag?: string): Promise<string> {
    const pixels = await this.preprocess(image, debugTag);
    const embeds = (await this.vision.run({ pixel_values: pixels })).vision_embeds as ort.Tensor;
    let out = await this.prefill.run({ vision_embeds: embeds, input_ids: int64Scalar(BOS) });
    let position = embeds.dims[1] + 1;
    const seen = new Set<number>([BOS]);
    const tokens: number[] = [];

    for (let n = 0; n < MAX_NEW_TOKENS; n++) {
      if (signal?.aborted) throw new Error("Inference aborted (timeout)");
      const logits = lastLogits(out.logits as ort.Tensor);
      for (const id of seen) logits[id] = logits[id] < 0 ? logits[id] * REPETITION_PENALTY : logits[id] / REPETITION_PENALTY;

      const last = tokens.at(-1);
      if (last !== undefined && this.contentIds.has(last)) {
        let run = 0;
        for (let i = tokens.length - 1; i >= 0 && tokens[i] === last; i--) run++;
        if (run >= MAX_CONTENT_RUN) logits[last] = -Infinity;
      }

      const next = argmax(logits);
      if (next === EOS) break;
      tokens.push(next);
      seen.add(next);
      if (tokens.length >= MAX_NEW_TOKENS) break;

      const feed: Record<string, ort.Tensor> = { input_ids: int64Scalar(next), position_ids: int64Scalar(position) };
      for (let l = 0; l < LAYERS; l++) {
        feed[`past_k${l}`] = out[`present_k${l}`] as ort.Tensor;
        feed[`past_v${l}`] = out[`present_v${l}`] as ort.Tensor;
      }
      out = await this.step.run(feed);
      position++;
    }

    return tokens.filter((id) => id >= SPECIAL_IDS).map((id) => this.charset[id - SPECIAL_IDS] ?? "").join("");
  }
}

/** Load Baberu OCR and register it as the `ocr` inference handler. */
export async function loadBaberuOcrModel(dir: string = env.OCR_MODELS_DIR): Promise<void> {
  const model = await BaberuOcr.load(dir);
  inferenceHandlers.ocr = async (input: unknown, signal: AbortSignal): Promise<OcrOutput> => {
    const { imageBuffer } = input as OcrInput;
    const start = Date.now();
    const tag = env.OCR_DEBUG ? start.toString(36) : undefined;
    const text = await model.recognize(imageBuffer, signal, tag);
    if (tag) log.debug({ tag, text }, `OCR debug — "${text}"`);
    return { text, processingTimeMs: Date.now() - start };
  };
  bootState.ocrReady = true;
  log.info("Baberu OCR model loaded.");
}
