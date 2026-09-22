/**
 * The leftover-ink measure the regression runner compares cleans by: 0 when the lettering is gone, 1 when it isn't,
 * and in between for a partial clean — whatever colour the bubble is.
 */
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { leftoverInk, overallInk } from "@/services/clean-check";

const W = 100, H = 100;
const LETTERING = { x: 40, y: 40, w: 20, h: 20 };

/** A page of one grey level, with the lettering square drawn in another (or not at all). */
async function page(background: number, ink: number | null, inkShare = 1): Promise<Buffer> {
  const pixels = Buffer.alloc(W * H * 3, background);
  if (ink !== null) {
    let drawn = 0;
    const total = LETTERING.w * LETTERING.h;
    for (let y = LETTERING.y; y < LETTERING.y + LETTERING.h; y++) {
      for (let x = LETTERING.x; x < LETTERING.x + LETTERING.w; x++) {
        if (drawn++ >= total * inkShare) continue;
        pixels.fill(ink, (y * W + x) * 3, (y * W + x) * 3 + 3);
      }
    }
  }
  return sharp(pixels, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

/** The detector's mask: the lettering square. */
async function mask(): Promise<Buffer> {
  const pixels = Buffer.alloc(W * H, 0);
  for (let y = LETTERING.y; y < LETTERING.y + LETTERING.h; y++) pixels.fill(255, y * W + LETTERING.x, y * W + LETTERING.x + LETTERING.w);
  return sharp(pixels, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

const block = { id: 1, x: 30, y: 30, w: 40, h: 40 };

describe("leftover ink", () => {
  test("a clean that removed the lettering scores 0, one that removed nothing scores 1", async () => {
    expect((await leftoverInk(await page(250, null), await mask(), [block]))[0]).toMatchObject({ ink: 0, marked: 400 });
    expect((await leftoverInk(await page(250, 10), await mask(), [block]))[0]?.ink).toBe(1);
  });

  test("works the same on a dark bubble with white lettering", async () => {
    expect((await leftoverInk(await page(20, 240), await mask(), [block]))[0]?.ink).toBe(1);
    expect((await leftoverInk(await page(20, null), await mask(), [block]))[0]?.ink).toBe(0);
  });

  test("a partial clean scores in between, and blocks average by how much each had to clean", async () => {
    const [half] = await leftoverInk(await page(250, 10, 0.5), await mask(), [block]);
    expect(half?.ink).toBeCloseTo(0.5, 1);
    expect(overallInk([{ blockId: 1, ink: 1, marked: 300 }, { blockId: 2, ink: 0, marked: 100 }])).toBe(0.75);
  });

  test("a block with nothing marked has nothing to clean", async () => {
    const [empty] = await leftoverInk(await page(250, 10), await mask(), [{ id: 2, x: 0, y: 0, w: 20, h: 20 }]);
    expect(empty).toEqual({ blockId: 2, ink: 0, marked: 0 });
  });
});
