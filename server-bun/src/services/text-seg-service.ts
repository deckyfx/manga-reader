/**
 * Text detection with comictextdetector (manga-image-translator beta-0.3 ONNX).
 * Input  `images`: float32[1,3,1024,1024] — letterboxed RGB in [0,1]
 * Output `seg`:    float32[1,1,1024,1024] — per-pixel text probability
 * Output `blk`:    float32[1,N,7]         — text-block boxes [cx, cy, w, h, objectness, cls0, cls1]
 * (`det` line map is unused)
 */
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { env } from "@/env";
import { bootState } from "@/boot-state";
import { inferenceHandlers } from "@/queue/inference-queue";
import { childLogger } from "@/lib/logger";
import { buildBlocks, type Box, type TextBlock } from "@/lib/mask";

const log = childLogger("textseg");

const MODEL_SIZE = 1024;
const MASK_THRESHOLD = 0.3;
const LETTERBOX_GRAY = 114;
const BLOCK_CONFIDENCE = 0.4;
const NMS_IOU = 0.35;

export type TextSegBox = Box;

export interface TextSegInput {
  imageBuffer: Buffer;
  /** Unused — dimensions are read from the image. Kept for existing callers. */
  origWidth?: number;
  origHeight?: number;
}

export interface TextSegResult {
  width: number;
  height: number;
  /** Binary text mask at page resolution (1 = text). */
  mask: Uint8Array;
  /** Dialogue/caption ("text") blocks first, then leftover lettering ("sfx"). */
  blocks: TextBlock[];
}

export interface TextSegOutput {
  /** Dialogue/caption blocks only. */
  boxes: TextSegBox[];
  mask: Uint8Array;
  width: number;
  height: number;
  processingTimeMs: number;
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Decode `blk` detections into page-space boxes (confidence filter + NMS). */
function decodeTextBoxes(blk: ort.Tensor, scale: number, padLeft: number, padTop: number, width: number, height: number): Box[] {
  const data = blk.data as Float32Array;
  const [, count, stride] = blk.dims;
  const candidates: (Box & { score: number })[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const objectness = data[o + 4];
    if (objectness < BLOCK_CONFIDENCE) continue;
    const score = objectness * Math.max(data[o + 5], data[o + 6]);
    if (score < BLOCK_CONFIDENCE) continue;
    const toX = (v: number): number => Math.min(width, Math.max(0, (v - padLeft) / scale));
    const toY = (v: number): number => Math.min(height, Math.max(0, (v - padTop) / scale));
    const x0 = toX(data[o] - data[o + 2] / 2), x1 = toX(data[o] + data[o + 2] / 2);
    const y0 = toY(data[o + 1] - data[o + 3] / 2), y1 = toY(data[o + 1] + data[o + 3] / 2);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    candidates.push({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: Box[] = [];
  for (const { score: _score, ...box } of candidates) if (kept.every((k) => iou(k, box) < NMS_IOU)) kept.push(box);
  return kept;
}

export class TextSegmenter {
  private constructor(private readonly session: ort.InferenceSession) {}

  static async load(modelPath: string): Promise<TextSegmenter> {
    if (!existsSync(modelPath)) throw new Error(`TextSeg model not found at ${modelPath}`);
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    return new TextSegmenter(session);
  }

  /**
   * Text-pixel mask at page resolution plus text and SFX blocks. `textBoxes` (e.g. from the bubble
   * detector) decide how text is grouped; without them the model's own `blk` boxes are used.
   */
  async segment(image: Buffer, textBoxes?: Box[]): Promise<TextSegResult> {
    const { data: rgb, info } = await sharp(image).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // Letterbox: fit inside 1024² keeping aspect, centred on gray (matches the C# service)
    const scale = Math.min(MODEL_SIZE / width, MODEL_SIZE / height);
    const fitW = Math.max(1, Math.round(width * scale));
    const fitH = Math.max(1, Math.round(height * scale));
    const padLeft = Math.round((MODEL_SIZE - fitW) / 2 - 0.1);
    const padTop = Math.round((MODEL_SIZE - fitH) / 2 - 0.1);
    const boxed = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .resize(fitW, fitH, { kernel: "linear" })
      .extend({
        left: padLeft,
        right: MODEL_SIZE - fitW - padLeft,
        top: padTop,
        bottom: MODEL_SIZE - fitH - padTop,
        background: { r: LETTERBOX_GRAY, g: LETTERBOX_GRAY, b: LETTERBOX_GRAY },
      })
      .raw()
      .toBuffer();

    const plane = MODEL_SIZE * MODEL_SIZE;
    const pixels = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) pixels[c * plane + i] = boxed[i * 3 + c] / 255;
    }
    const outputs = await this.session.run({ images: new ort.Tensor("float32", pixels, [1, 3, MODEL_SIZE, MODEL_SIZE]) });
    const seg = outputs.seg as ort.Tensor;
    const [, , segH, segW] = seg.dims;
    const probs = seg.data as Float32Array;

    // Threshold the content area (letterbox padding removed) at model resolution
    const s = segW / MODEL_SIZE;
    const left = Math.round(padLeft * s), top = Math.round(padTop * s);
    const cropW = Math.max(1, Math.min(segW - left, Math.round(fitW * s)));
    const cropH = Math.max(1, Math.min(segH - top, Math.round(fitH * s)));
    const small = Buffer.alloc(cropW * cropH);
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) small[y * cropW + x] = probs[(y + top) * segW + x + left] > MASK_THRESHOLD ? 255 : 0;
    }

    // sharp can promote single-channel raw input to 3 channels on resize; extractChannel keeps one.
    const { data: up, info: upInfo } = await sharp(small, { raw: { width: cropW, height: cropH, channels: 1 } })
      .resize(width, height, { kernel: "linear" })
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (upInfo.channels !== 1 || upInfo.width !== width || upInfo.height !== height) {
      throw new Error(`Unexpected mask shape ${upInfo.width}x${upInfo.height}x${upInfo.channels}`);
    }
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = up[i] >= 128 ? 1 : 0;

    const groups = textBoxes?.length ? textBoxes : decodeTextBoxes(outputs.blk as ort.Tensor, scale, padLeft, padTop, width, height);
    return { width, height, mask, blocks: buildBlocks(mask, width, height, groups) };
  }
}

/** Path of the comictextdetector model inside TEXT_SEG_MODELS_DIR. */
export function textSegModelPath(): string {
  return join(env.TEXT_SEG_MODELS_DIR, basename(env.TEXT_SEG_MODEL_FILES[0]));
}

let sharedSegmenter: Promise<TextSegmenter> | null = null;

/** Process-wide segmenter, loaded on first use and shared by the inference queue and the page pipeline. */
export function getTextSegmenter(): Promise<TextSegmenter> {
  sharedSegmenter ??= TextSegmenter.load(textSegModelPath()).catch((err: unknown) => {
    sharedSegmenter = null;
    throw err;
  });
  return sharedSegmenter;
}

export async function loadTextSegModel(): Promise<void> {
  const segmenter = await getTextSegmenter();
  inferenceHandlers["text-seg"] = async (input: unknown, signal: AbortSignal): Promise<TextSegOutput> => {
    if (signal.aborted) throw new Error("Inference aborted (timeout)");
    const start = Date.now();
    const result = await segmenter.segment((input as TextSegInput).imageBuffer);
    const boxes = result.blocks.filter((b) => b.kind === "text").map(({ x, y, w, h }) => ({ x, y, w, h }));
    return { boxes, mask: result.mask, width: result.width, height: result.height, processingTimeMs: Date.now() - start };
  };
  bootState.textSegReady = true;
  log.info("TextSeg (comictextdetector) model loaded.");
}
