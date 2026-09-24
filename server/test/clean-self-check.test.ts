/**
 * The self-check the clean stage records per block: how it was cleaned and how much of its lettering still shows.
 * This covers measuring it again after a partial re-clean, which needs no models.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "@/lib/sharp";
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

describe("painted additions and ownership", () => {
  test("lettering joined to a painted stroke still counts against its block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "self-check-bridge-"));
    // Two blocks side by side. In each, the upper strokes were cleaned away and the lower ones still show
    const boxes = [
      { id: 1, kind: "text" as const, x: 5, y: 20, w: 45, h: 70, include: true, source_text: null, translated_text: null },
      { id: 2, kind: "text" as const, x: 70, y: 20, w: 45, h: 70, include: true, source_text: null, translated_text: null },
    ];
    const page = Buffer.alloc(W * H * 3, 250);
    const detected = Buffer.alloc(W * H, 0);
    const painted = Buffer.alloc(W * H, 0);
    for (const box of boxes) {
      for (let y = box.y + 5; y < box.y + 20; y++) for (let x = box.x + 5; x < box.x + 40; x++) if ((x + y) % 3 === 0) detected[y * W + x] = 255;
      for (let y = box.y + 40; y < box.y + 55; y++) {
        for (let x = box.x + 5; x < box.x + 40; x++) {
          if ((x + y) % 3 !== 0) continue;
          detected[y * W + x] = 255;
          page.fill(15, (y * W + x) * 3, (y * W + x) * 3 + 3);
        }
      }
    }
    // A painted band across the gap, joining both blocks' lower strokes into one blob that belongs to neither
    for (let y = 63; y < 69; y++) painted.fill(255, y * W + 8, y * W + 112);

    const save = (pixels: Buffer, file: string) => sharp(pixels, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(dir, file));
    await sharp(page, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(dir, "clean-text.png"));
    await save(detected, "mask.png");
    await save(painted, "mask-add.png");

    const pipeline = new PagePipeline(dir);
    const bridged: PageJob = { source: "test", width: W, height: H, blocks: boxes.map((box) => ({ ...box, clean: { method: "flat" as const, ink: 0 } })) };
    await pipeline.refreshCleanCheck(bridged);
    // Ownership read from the painted mask gives that blob to nobody, so each block would be measured on its cleaned
    // half alone and read as spotless while its lettering still shows
    expect(bridged.blocks[0]!.clean!.ink).toBeGreaterThan(0.3);
    expect(bridged.blocks[1]!.clean!.ink).toBeGreaterThan(0.3);
  });
});

describe("stale self-checks", () => {
  test("a block left out of the clean, and the sound effects a text clean threw away, lose theirs", async () => {
    const dir = await pageFolder("clean");
    await Bun.write(join(dir, "original.png"), await Bun.file(join(dir, "clean-text.png")).arrayBuffer());
    const pipeline = new PagePipeline(dir);
    const current = job();
    // Nothing to clean: one text block excluded, one sound effect checked by an earlier SFX pass
    current.blocks[0]!.include = false;
    current.blocks.push({ id: 2, kind: "sfx", x: 0, y: 0, w: 10, h: 10, include: true, source_text: null, translated_text: null, clean: { method: "lama", ink: 0.5 } });
    await pipeline.clean(current, "text");
    expect(current.blocks[0]?.clean).toBeUndefined();
    expect(current.blocks[1]?.clean).toBeUndefined();
  });
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
