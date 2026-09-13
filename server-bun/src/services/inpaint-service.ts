/**
 * Manga text removal with LaMa fine-tuned on anime/manga (dreMaz/AnimeMangaInpainting,
 * dynamic-size ONNX export from ogkalu/lama-manga-onnx-dynamic).
 * Inputs `image` float32[1,3,H,W] and `mask` float32[1,1,H,W] in [0,1]; output `inpainted` in [0,1].
 */
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { env } from "@/env";
import { bootState } from "@/boot-state";
import { inferenceHandlers } from "@/queue/inference-queue";
import { childLogger } from "@/lib/logger";
import { dilateMask, type Box } from "@/lib/mask";

const log = childLogger("inpaint");

/** Surrounding pixels fed to LaMa with each region so it can continue the texture. */
const CONTEXT_MARGIN = 48;
/** Grow text strokes so anti-aliased edges are removed too. */
const MASK_DILATE = 4;
/** The network downsamples 3× by 2, so sides must be multiples of 8. */
const STRIDE = 8;

export interface InpaintInput {
  imageBuffer: Buffer;
  /** Binary mask at image resolution of the text pixels to remove (1 = remove). */
  mask: Uint8Array;
  /** Areas to process; LaMa runs on a crop around each. */
  regions: Box[];
}

export interface InpaintOutput {
  /** PNG of the cleaned page. */
  imageBuffer: Buffer;
  processingTimeMs: number;
}

export class MangaInpainter {
  private constructor(private readonly session: ort.InferenceSession) {}

  static async load(modelPath: string): Promise<MangaInpainter> {
    if (!existsSync(modelPath)) throw new Error(`Inpaint model not found at ${modelPath}`);
    const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    return new MangaInpainter(session);
  }

  /**
   * Remove `mask` pixels (grown slightly) using LaMa on a crop around each region at native resolution.
   * Only those pixels are replaced; everything else stays byte-identical.
   */
  async inpaintRgb(rgb: Buffer, width: number, height: number, mask: Uint8Array, regions: Box[], signal?: AbortSignal): Promise<Buffer> {
    const pending = dilateMask(mask, width, height, MASK_DILATE);
    const result = Buffer.from(rgb);

    for (const region of regions) {
      if (signal?.aborted) throw new Error("Inference aborted (timeout)");
      const x0 = Math.max(0, region.x - CONTEXT_MARGIN), y0 = Math.max(0, region.y - CONTEXT_MARGIN);
      const x1 = Math.min(width, region.x + region.w + CONTEXT_MARGIN), y1 = Math.min(height, region.y + region.h + CONTEXT_MARGIN);
      const cropW = x1 - x0, cropH = y1 - y0;
      const padW = Math.ceil(cropW / STRIDE) * STRIDE, padH = Math.ceil(cropH / STRIDE) * STRIDE;

      const plane = padW * padH;
      const maskPlane = new Float32Array(plane);
      let masked = 0;
      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          if (pending[(y + y0) * width + x + x0]) {
            maskPlane[y * padW + x] = 1;
            masked++;
          }
        }
      }
      if (masked === 0) continue;

      // Crop from the progressively cleaned result so overlapping regions build on each other
      const crop = await sharp(result, { raw: { width, height, channels: 3 } })
        .extract({ left: x0, top: y0, width: cropW, height: cropH })
        .extend({ right: padW - cropW, bottom: padH - cropH, extendWith: "mirror" })
        .raw()
        .toBuffer();
      const image = new Float32Array(3 * plane);
      for (let i = 0; i < plane; i++) {
        for (let c = 0; c < 3; c++) image[c * plane + i] = crop[i * 3 + c] / 255;
      }

      const out = (await this.session.run({
        image: new ort.Tensor("float32", image, [1, 3, padH, padW]),
        mask: new ort.Tensor("float32", maskPlane, [1, 1, padH, padW]),
      })).inpainted.data as Float32Array;

      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          if (!maskPlane[y * padW + x]) continue;
          const p = (y + y0) * width + x + x0;
          for (let c = 0; c < 3; c++) result[p * 3 + c] = Math.max(0, Math.min(255, Math.round(out[c * plane + y * padW + x] * 255)));
          pending[p] = 0;
        }
      }
    }
    return result;
  }
}

/** Path of the inpaint model inside INPAINT_MODELS_DIR. */
export function inpaintModelPath(): string {
  return join(env.INPAINT_MODELS_DIR, basename(env.INPAINT_MODEL_FILES[0]));
}

export async function loadInpaintModel(): Promise<void> {
  const inpainter = await MangaInpainter.load(inpaintModelPath());
  inferenceHandlers.inpaint = async (input: unknown, signal: AbortSignal): Promise<InpaintOutput> => {
    const { imageBuffer, mask, regions } = input as InpaintInput;
    const start = Date.now();
    const { data, info } = await sharp(imageBuffer).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (mask.length !== info.width * info.height) throw new Error("Mask size does not match image");
    const cleaned = await inpainter.inpaintRgb(data, info.width, info.height, mask, regions, signal);
    const png = await sharp(cleaned, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
    return { imageBuffer: png, processingTimeMs: Date.now() - start };
  };
  bootState.inpaintReady = true;
  log.info("Inpaint (manga LaMa) model loaded.");
}
