/**
 * The inpainter's plain-background fast path. It fills a region with the background colour only when the ring around
 * it really is one colour — judged by colour, since a colour page can be one brightness in several colours.
 */
import { describe, expect, test } from "bun:test";
import { flatFill } from "@/services/inpaint-service";

const W = 60, H = 60;
const REGION = { x: 20, y: 20, w: 20, h: 20 };

/** A page from `colour(x, y)`, with dark lettering inside the region; its pending mask and the ring around it. */
function scene(colour: (x: number, y: number) => [number, number, number]) {
  const source = Buffer.alloc(W * H * 3);
  const pending = new Uint8Array(W * H);
  const ring = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const inside = x >= REGION.x && x < REGION.x + REGION.w && y >= REGION.y && y < REGION.y + REGION.h;
      const lettering = inside && (x + y) % 3 === 0;
      source.set(lettering ? [10, 10, 10] : colour(x, y), p * 3);
      if (lettering) pending[p] = 1;
      // The ring: a band around the region, outside the lettering
      const nearX = x >= REGION.x - 8 && x < REGION.x + REGION.w + 8, nearY = y >= REGION.y - 8 && y < REGION.y + REGION.h + 8;
      if (nearX && nearY && !inside) ring[p] = 1;
    }
  }
  return { source, result: Buffer.from(source), pending, ring };
}

/** A pixel of the result; (21, 21) is lettering in every scene. */
const pixel = (rgb: Buffer, x: number, y: number) => [...rgb.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];

describe("flat fill", () => {
  test("fills lettering on a plain white bubble with white", () => {
    const { source, result, pending, ring } = scene(() => [250, 250, 250]);
    expect(flatFill(source, result, W, H, pending, ring, REGION)).toBe(true);
    expect(pixel(result, REGION.x + 1, REGION.y + 1)).toEqual([250, 250, 250]);
  });

  test("leaves a background of two colours at the same brightness to the inpainter", () => {
    // Red and green stripes: the same brightness (≈ 76), so a brightness check called them one colour
    const { source, result, pending, ring } = scene((x) => (x % 4 < 2 ? [255, 0, 0] : [0, 130, 0]));
    expect(flatFill(source, result, W, H, pending, ring, REGION)).toBe(false);
    expect(pixel(result, REGION.x + 1, REGION.y + 1)).toEqual([10, 10, 10]);
  });

  test("a slightly noisy colour background still counts as plain, and is filled with its own colour", () => {
    const { source, result, pending, ring } = scene((x, y) => [180 + ((x * 7 + y) % 5), 210, 240 - ((x + y) % 4)]);
    expect(flatFill(source, result, W, H, pending, ring, REGION)).toBe(true);
    const [r, g, b] = pixel(result, REGION.x + 1, REGION.y + 1);
    expect(Math.abs(r! - 182)).toBeLessThanOrEqual(3);
    expect(g).toBe(210);
    expect(Math.abs(b! - 238)).toBeLessThanOrEqual(3);
  });
});
