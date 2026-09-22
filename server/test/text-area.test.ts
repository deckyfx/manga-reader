/**
 * Where a text block's lettering goes on the cleaned page: inside its bubble, or — for text written straight onto the
 * artwork, a narration or an inner monologue — inside the block's own box, rather than nowhere.
 */
import { describe, expect, test } from "bun:test";
import { textAreaFor } from "@/services/typeset-service";

const W = 200, H = 200;

/** An RGB page filled by `shade(x, y)` (0–255 grey). */
function page(shade: (x: number, y: number) => number): Buffer {
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) rgb.fill(shade(x, y), (y * W + x) * 3, (y * W + x) * 3 + 3);
  }
  return rgb;
}

const allowed = (mask: Uint8Array): number => mask.reduce((sum, v) => sum + v, 0);

describe("text areas", () => {
  test("text in a bubble gets the bubble's interior", () => {
    // A white bubble (a black outline around a white disc) on mid-grey artwork, the text block in its middle
    const rgb = page((x, y) => {
      const d = Math.hypot(x - 100, y - 100);
      return d < 60 ? 255 : d < 64 ? 0 : 128;
    });
    const block = { x: 80, y: 85, w: 40, h: 30 };
    const area = textAreaFor(rgb, W, H, block, { x: 36, y: 36, w: 128, h: 128 });
    // Bigger than the text itself, and inside the outline
    expect(allowed(area?.mask ?? new Uint8Array())).toBeGreaterThan(block.w * block.h);
    expect(area?.bound.x).toBeGreaterThanOrEqual(36);
  });

  test("text written on the artwork, with no bubble around it, gets its own box instead of nothing", () => {
    // Busy artwork: a checkerboard of dark and light, so no plain background to flood through
    const rgb = page((x, y) => ((x >> 1) + (y >> 1)) % 2 === 0 ? 20 : 235);
    const block = { x: 50, y: 60, w: 70, h: 50 };
    const area = textAreaFor(rgb, W, H, block, null);
    expect(area?.bound).toEqual(block);
    expect(allowed(area?.mask ?? new Uint8Array())).toBe(block.w * block.h);
  });

  test("a block hanging off the page keeps only the part on it", () => {
    const rgb = page((x, y) => ((x >> 1) + (y >> 1)) % 2 === 0 ? 20 : 235);
    const area = textAreaFor(rgb, W, H, { x: 170, y: -10, w: 60, h: 40 }, null);
    expect(area?.bound).toEqual({ x: 170, y: 0, w: 30, h: 30 });
  });

  test("a block entirely off the page gets no area, past any edge", () => {
    const rgb = page((x, y) => ((x >> 1) + (y >> 1)) % 2 === 0 ? 20 : 235);
    for (const block of [
      { x: -50, y: 50, w: 40, h: 40 }, // left
      { x: W + 10, y: 50, w: 40, h: 40 }, // right
      { x: 50, y: -50, w: 40, h: 40 }, // above
      { x: 50, y: H, w: 40, h: 40 }, // below, touching the edge only
    ]) {
      expect(textAreaFor(rgb, W, H, block, null)).toBeNull();
    }
  });
});
