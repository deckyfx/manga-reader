/**
 * Manga text removal. Regions on a plain background (speech bubbles, caption boxes) are flat-filled with
 * the background colour; everything else uses LaMa fine-tuned on anime/manga (dreMaz/AnimeMangaInpainting,
 * dynamic-size ONNX export from ogkalu/lama-manga-onnx-dynamic).
 * LaMa inputs `image` float32[1,3,H,W] and `mask` float32[1,1,H,W] in [0,1]; output `inpainted` in [0,1].
 */
import * as ort from "onnxruntime-node";
import sharp from "@/lib/sharp";
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
/** Width of the ring around the mask sampled to decide whether a region sits on a plain background. */
const RING = 6;
/** How far (per colour channel, 0–255) from the ring's median colour a pixel may be and still count as background. */
const FLAT_TOLERANCE = 24;
/** Share of ring pixels that must be background for a flat fill. */
const FLAT_SHARE = 0.9;
const MIN_RING_PIXELS = 50;

export interface InpaintInput {
  imageBuffer: Buffer;
  /** Binary mask at image resolution of the text pixels to remove (1 = remove). */
  mask: Uint8Array;
  /** Areas to process — typically one per text block. */
  regions: Box[];
}

export interface InpaintOutput {
  /** PNG of the cleaned page. */
  imageBuffer: Buffer;
  processingTimeMs: number;
}

/** How a region was cleaned: painted with the background colour, or redrawn by LaMa. */
export type CleanMethod = "flat" | "lama";

export interface InpaintResult {
  rgb: Buffer;
  /** Regions painted with their background colour. */
  flat: number;
  /** Regions sent to LaMa. */
  lama: number;
  /** How each region given was cleaned, in the order they were given. */
  methods: CleanMethod[];
}

/**
 * How far a pixel's colour is from `colour`: the largest difference on any one channel. On a grey page that is the
 * brightness difference; on a colour page, red and green of the same brightness are as far apart as they look.
 */
const colourDistance = (rgb: Buffer, p: number, colour: readonly number[]): number =>
  Math.max(Math.abs(rgb[p * 3]! - colour[0]!), Math.abs(rgb[p * 3 + 1]! - colour[1]!), Math.abs(rgb[p * 3 + 2]! - colour[2]!));

/** The per-channel median colour of these pixels. */
function medianColour(rgb: Buffer, pixels: readonly number[]): number[] {
  return [0, 1, 2].map((c) => {
    const values = pixels.map((p) => rgb[p * 3 + c]!).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  });
}

function expand(box: Box, margin: number, width: number, height: number): Box {
  const x = Math.max(0, box.x - margin), y = Math.max(0, box.y - margin);
  return { x, y, w: Math.min(width, box.x + box.w + margin) - x, h: Math.min(height, box.y + box.h + margin) - y };
}

/**
 * Union windows that overlap. Cleaning overlapping windows separately cuts text at a window edge and
 * leaves ghost strokes, because the first pass sees only half of each character.
 */
function mergeWindows(windows: Box[]): Box[] {
  const merged = windows.map((w) => ({ ...w }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        if (a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        merged[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        merged.splice(j, 1);
        j--;
        changed = true;
      }
    }
  }
  return merged;
}

/**
 * Plain-background fast path: when the ring around the region's mask is near-uniform, paint the masked
 * pixels — and faint anti-aliasing halos in the ring — with the background colour. On flat white LaMa
 * leaves specks and ghost strokes; this is exact and instant. Dark pixels (bubble outlines) are untouched.
 *
 * "Near-uniform" is judged in colour, not brightness: a colour page's two-tone or patterned background can be one
 * brightness and several colours, and filling it with one of them is the wrong clean. Exported for its tests.
 */
export function flatFill(source: Buffer, result: Buffer, width: number, height: number, pending: Uint8Array, ring: Uint8Array, region: Box): boolean {
  const area = expand(region, MASK_DILATE + RING, width, height);
  const samples: number[] = [];
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const p = y * width + x;
      if (ring[p] && !pending[p]) samples.push(p);
    }
  }
  if (samples.length < MIN_RING_PIXELS) return false;

  const ringColour = medianColour(source, samples);
  const background = samples.filter((p) => colourDistance(source, p, ringColour) <= FLAT_TOLERANCE);
  if (background.length / samples.length < FLAT_SHARE) return false;

  const colour = medianColour(source, background);
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const p = y * width + x;
      if (!pending[p] && !(ring[p] && colourDistance(source, p, ringColour) <= FLAT_TOLERANCE)) continue;
      result[p * 3] = colour[0];
      result[p * 3 + 1] = colour[1];
      result[p * 3 + 2] = colour[2];
      pending[p] = 0;
    }
  }
  return true;
}

export class MangaInpainter {
  private session: ort.InferenceSession | null = null;

  private constructor(private readonly modelPath: string) {}

  /** `eager = false` defers loading LaMa until a region actually needs it. */
  static async load(modelPath: string, eager = true): Promise<MangaInpainter> {
    if (!existsSync(modelPath)) throw new Error(`Inpaint model not found at ${modelPath}`);
    const inpainter = new MangaInpainter(modelPath);
    if (eager) await inpainter.getSession();
    return inpainter;
  }

  /** Load LaMa now instead of on the first region that needs it. */
  async preload(): Promise<void> {
    await this.getSession();
  }

  private async getSession(): Promise<ort.InferenceSession> {
    this.session ??= await ort.InferenceSession.create(this.modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
    return this.session;
  }

  /**
   * Remove `mask` pixels (grown slightly) inside `regions`: flat fill on plain backgrounds, LaMa on
   * merged windows elsewhere at native resolution. Unmasked pixels stay byte-identical.
   */
  async inpaintRgb(rgb: Buffer, width: number, height: number, mask: Uint8Array, regions: Box[], signal?: AbortSignal): Promise<InpaintResult> {
    const pending = dilateMask(mask, width, height, MASK_DILATE);
    const ring = dilateMask(pending, width, height, RING);
    const result = Buffer.from(rgb);

    const methods: CleanMethod[] = regions.map((region) => (flatFill(rgb, result, width, height, pending, ring, region) ? "flat" : "lama"));
    const lamaRegions = regions.filter((_, i) => methods[i] === "lama");
    const windows = mergeWindows(lamaRegions.map((region) => expand(region, CONTEXT_MARGIN, width, height)));

    for (const win of windows) {
      if (signal?.aborted) throw new Error("Inference aborted (timeout)");
      const padW = Math.ceil(win.w / STRIDE) * STRIDE, padH = Math.ceil(win.h / STRIDE) * STRIDE;
      const plane = padW * padH;
      const maskPlane = new Float32Array(plane);
      let masked = 0;
      for (let y = 0; y < win.h; y++) {
        for (let x = 0; x < win.w; x++) {
          if (pending[(y + win.y) * width + x + win.x]) {
            maskPlane[y * padW + x] = 1;
            masked++;
          }
        }
      }
      if (masked === 0) continue;

      const crop = await sharp(result, { raw: { width, height, channels: 3 } })
        .extract({ left: win.x, top: win.y, width: win.w, height: win.h })
        .extend({ right: padW - win.w, bottom: padH - win.h, extendWith: "mirror" })
        .raw()
        .toBuffer();
      const image = new Float32Array(3 * plane);
      for (let i = 0; i < plane; i++) {
        for (let c = 0; c < 3; c++) image[c * plane + i] = crop[i * 3 + c] / 255;
      }

      const session = await this.getSession();
      const out = (await session.run({
        image: new ort.Tensor("float32", image, [1, 3, padH, padW]),
        mask: new ort.Tensor("float32", maskPlane, [1, 1, padH, padW]),
      })).inpainted.data as Float32Array;

      for (let y = 0; y < win.h; y++) {
        for (let x = 0; x < win.w; x++) {
          if (!maskPlane[y * padW + x]) continue;
          const p = (y + win.y) * width + x + win.x;
          for (let c = 0; c < 3; c++) result[p * 3 + c] = Math.max(0, Math.min(255, Math.round(out[c * plane + y * padW + x] * 255)));
          pending[p] = 0;
        }
      }
    }
    return { rgb: result, flat: regions.length - lamaRegions.length, lama: lamaRegions.length, methods };
  }
}

/** Path of the inpaint model inside INPAINT_MODELS_DIR. */
export function inpaintModelPath(): string {
  return join(env.INPAINT_MODELS_DIR, basename(env.INPAINT_MODEL_FILES[0]));
}

let sharedInpainter: Promise<MangaInpainter> | null = null;

/** Process-wide inpainter shared by the inference queue and the page pipeline; LaMa loads on first need. */
export function getInpainter(): Promise<MangaInpainter> {
  sharedInpainter ??= MangaInpainter.load(inpaintModelPath(), false).catch((err: unknown) => {
    sharedInpainter = null;
    throw err;
  });
  return sharedInpainter;
}

export async function loadInpaintModel(): Promise<void> {
  const inpainter = await getInpainter();
  await inpainter.preload();
  inferenceHandlers.inpaint = async (input: unknown, signal: AbortSignal): Promise<InpaintOutput> => {
    const { imageBuffer, mask, regions } = input as InpaintInput;
    const start = Date.now();
    const { data, info } = await sharp(imageBuffer).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (mask.length !== info.width * info.height) throw new Error("Mask size does not match image");
    const { rgb } = await inpainter.inpaintRgb(data, info.width, info.height, mask, regions, signal);
    const png = await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
    return { imageBuffer: png, processingTimeMs: Date.now() - start };
  };
  bootState.inpaintReady = true;
  log.info("Inpaint (manga LaMa) model loaded.");
}
