/**
 * The self-check the clean stage records per block: how it was cleaned and how much of its lettering still shows.
 * This covers measuring it again after a partial re-clean, which needs no models.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { PagePipeline, type PageJob } from "@/services/page-pipeline";

const W = 120, H = 120;
const BLOCK = { x: 30, y: 30, w: 60, h: 60 };

/** A page folder holding a cleaned page and the mask of what should have been removed. */
async function pageFolder(cleaned: "clean" | "inked"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "self-check-"));
  const pixels = Buffer.alloc(W * H * 3, 250);
  const marks = Buffer.alloc(W * H, 0);
  // Strokes inside the block, as a mask of lettering looks: the rest of the block is bubble to compare against
  for (let y = BLOCK.y; y < BLOCK.y + BLOCK.h; y++) {
    for (let x = BLOCK.x; x < BLOCK.x + BLOCK.w; x++) {
      if ((x + y) % 3 !== 0) continue;
      marks[y * W + x] = 255;
      if (cleaned === "inked") pixels.fill(15, (y * W + x) * 3, (y * W + x) * 3 + 3);
    }
  }
  await sharp(pixels, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(dir, "clean-text.png"));
  await sharp(marks, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(dir, "mask.png"));
  return dir;
}

const job = (): PageJob => ({
  source: "test",
  width: W,
  height: H,
  blocks: [{ id: 1, kind: "text", ...BLOCK, include: true, source_text: null, translated_text: null, clean: { method: "flat", ink: 1 } }],
});

describe("the clean self-check", () => {
  test("a page that still shows its lettering measures as inked", async () => {
    const pipeline = new PagePipeline(await pageFolder("inked"));
    const current = job();
    await pipeline.refreshCleanCheck(current);
    expect(current.blocks[0]?.clean).toEqual({ method: "flat", ink: 1 });
  });

  test("measuring again after a fix clears it, keeping how the block was cleaned", async () => {
    const pipeline = new PagePipeline(await pageFolder("clean"));
    const current = job();
    await pipeline.refreshCleanCheck(current);
    expect(current.blocks[0]?.clean).toEqual({ method: "flat", ink: 0 });
  });

  test("blocks with no self-check yet are left alone", async () => {
    const pipeline = new PagePipeline(await pageFolder("clean"));
    const untouched = job();
    delete untouched.blocks[0]!.clean;
    await pipeline.refreshCleanCheck(untouched);
    expect(untouched.blocks[0]?.clean).toBeUndefined();
  });
});
