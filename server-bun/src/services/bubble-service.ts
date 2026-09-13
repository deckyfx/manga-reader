/**
 * Comic text & bubble detector (ogkalu/comic-text-and-bubble-detector, RT-DETR-v2).
 * Input  `images` float32[N,3,640,640] (page resized to 640², RGB in [0,1]) + `orig_target_sizes` int64[N,2] (width, height)
 * Output `labels` int64[1,300], `boxes` float32[1,300,4] (x0, y0, x1, y1 in page pixels), `scores` float32[1,300]
 * Classes: 0 = bubble, 1 = text_bubble (text inside a bubble), 2 = text_free (text outside bubbles)
 */
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { env } from "@/env";
import type { Box } from "@/lib/mask";

const INPUT_SIZE = 640;
const MIN_SCORE = 0.5;
const CLASS_BUBBLE = 0;
const CLASS_TEXT_BUBBLE = 1;
const CLASS_TEXT_FREE = 2;

export interface BubbleDetection {
  bubbles: Box[];
  /** One box per text group (per bubble or free-standing text) — used to group text pixels into blocks. */
  textBoxes: Box[];
}

export class BubbleDetector {
  private constructor(private readonly session: ort.InferenceSession) {}

  static async load(modelPath: string): Promise<BubbleDetector> {
    if (!existsSync(modelPath)) throw new Error(`Bubble detector model not found at ${modelPath}`);
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    return new BubbleDetector(session);
  }

  async detect(image: Buffer): Promise<BubbleDetection> {
    const { width = 0, height = 0 } = await sharp(image).metadata();
    const { data } = await sharp(image)
      .removeAlpha()
      .toColourspace("srgb")
      .resize(INPUT_SIZE, INPUT_SIZE, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const plane = INPUT_SIZE * INPUT_SIZE;
    const pixels = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) pixels[c * plane + i] = data[i * 3 + c] / 255;
    }
    const out = await this.session.run({
      images: new ort.Tensor("float32", pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]),
      orig_target_sizes: new ort.Tensor("int64", BigInt64Array.from([BigInt(width), BigInt(height)]), [1, 2]),
    });

    const labels = out.labels.data as BigInt64Array;
    const boxes = out.boxes.data as Float32Array;
    const scores = out.scores.data as Float32Array;
    const result: BubbleDetection = { bubbles: [], textBoxes: [] };
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] < MIN_SCORE) continue;
      const x0 = Math.max(0, Math.round(boxes[i * 4])), y0 = Math.max(0, Math.round(boxes[i * 4 + 1]));
      const x1 = Math.min(width, Math.round(boxes[i * 4 + 2])), y1 = Math.min(height, Math.round(boxes[i * 4 + 3]));
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const cls = Number(labels[i]);
      if (cls === CLASS_BUBBLE) result.bubbles.push(box);
      else if (cls === CLASS_TEXT_BUBBLE || cls === CLASS_TEXT_FREE) result.textBoxes.push(box);
    }
    return result;
  }
}

/** Path of the bubble detector model inside BUBBLE_MODELS_DIR. */
export function bubbleModelPath(): string {
  return join(env.BUBBLE_MODELS_DIR, basename(env.BUBBLE_MODEL_FILES[0]));
}

let sharedDetector: Promise<BubbleDetector | null> | null = null;

/** Process-wide detector, loaded on first use; null when the model file is not downloaded. */
export function getBubbleDetector(): Promise<BubbleDetector | null> {
  sharedDetector ??= existsSync(bubbleModelPath())
    ? BubbleDetector.load(bubbleModelPath()).catch((err: unknown) => {
        sharedDetector = null;
        throw err;
      })
    : Promise.resolve(null);
  return sharedDetector;
}
