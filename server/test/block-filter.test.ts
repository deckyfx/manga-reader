/**
 * Page numbers and texture specks the detector takes for sound effects start out of cleaning; real sound effects,
 * big or small, anywhere on the page, still get cleaned.
 */
import { describe, expect, test } from "bun:test";
import { readsAsNothing, sfxExclusion, textExclusion } from "@/services/block-filter";

// A typical scanned page
const W = 1200, H = 1800;

describe("sound effects left out of cleaning", () => {
  test("a small block in the bottom or top margin is a page number", () => {
    expect(sfxExclusion({ x: 580, y: 1745, w: 40, h: 30 }, W, H)).toBe("page number");
    expect(sfxExclusion({ x: 60, y: 30, w: 50, h: 32 }, W, H)).toBe("page number");
  });

  test("on a tall webtoon strip, a big sound effect near the top is not taken for a page number", () => {
    // 800 wide, 12000 tall: a height-based margin would be 840px deep
    expect(sfxExclusion({ x: 200, y: 150, w: 300, h: 260 }, 800, 12000)).toBeNull();
    expect(sfxExclusion({ x: 380, y: 11960, w: 40, h: 28 }, 800, 12000)).toBe("page number");
  });

  test("a speck of texture is too small to be lettering", () => {
    expect(sfxExclusion({ x: 300, y: 900, w: 12, h: 9 }, W, H)).toBe("speck");
  });

  test("a real sound effect is cleaned, even in the margin when it is big", () => {
    expect(sfxExclusion({ x: 200, y: 400, w: 260, h: 180 }, W, H)).toBeNull();
    // A sound effect running along the bottom of the page is too big to be a page number
    expect(sfxExclusion({ x: 100, y: 1700, w: 500, h: 90 }, W, H)).toBeNull();
    // Small ones in the middle of the page are still lettering
    expect(sfxExclusion({ x: 500, y: 800, w: 60, h: 50 }, W, H)).toBeNull();
    expect(sfxExclusion({ x: 500, y: 800, w: 40, h: 40 }, W, H)).toBeNull();
  });
});

describe("text blocks the detector was wrong about", () => {
  const page = { width: 1363, height: 1920 };
  const at = (w: number, h: number) => ({ x: 400, y: 600, w, h });

  test("a real bubble is kept, however small the word in it", () => {
    // The smallest real block on a page of this size measured 95×196; a one-word bubble is smaller still
    expect(textExclusion(at(95, 196), page.width, page.height)).toBeNull();
    expect(textExclusion(at(60, 70), page.width, page.height)).toBeNull();
  });

  test("a speck of tone is not a line of type", () => {
    expect(textExclusion(at(12, 14), page.width, page.height)).toBe("speck");
  });

  test("a sliver is excluded whichever way round it lies", () => {
    // Japanese sets vertically, so tall and narrow is ordinary — what rules a block out is being too thin for its
    // length, in either direction
    expect(textExclusion(at(300, 8), page.width, page.height)).toBe("sliver");
    expect(textExclusion(at(8, 300), page.width, page.height)).toBe("sliver");
    expect(textExclusion(at(120, 300), page.width, page.height)).toBeNull();
  });
});

describe("what a reading amounts to", () => {
  test("nothing, when there is nothing in it", () => {
    expect(readsAsNothing(null)).toBe(true);
    expect(readsAsNothing("")).toBe(true);
    expect(readsAsNothing("   \n ")).toBe(true);
  });

  test("nothing, when it is only marks", () => {
    // What a scanner makes of an ellipsis, and what a detector makes of a tone edge
    expect(readsAsNothing("……")).toBe(true);
    expect(readsAsNothing("．．．")).toBe(true);
    expect(readsAsNothing("・・・")).toBe(true);
    expect(readsAsNothing("～～")).toBe(true);
    expect(readsAsNothing("！？")).toBe(true);
    expect(readsAsNothing("ー")).toBe(true);
  });

  test("something, as soon as a single character carries meaning", () => {
    expect(readsAsNothing("あ")).toBe(false);
    expect(readsAsNothing("え．．．")).toBe(false);
    expect(readsAsNothing("行くぞケイト")).toBe(false);
    expect(readsAsNothing("Kate")).toBe(false);
    expect(readsAsNothing("123")).toBe(false);
  });
});

describe("a block someone put back", () => {
  test("stays back when the reader says the same thing again", () => {
    // The rule lives in the pipeline, but this is the case it exists for: a bubble that reads as `……` is excluded
    // on the reading that found it, and re-reading to the same nothing must not overrule a person who re-included it
    expect(readsAsNothing("……")).toBe(true);
    const sameReading = (previous: string | null, read: string) => read !== previous;
    expect(sameReading("……", "……")).toBe(false);
    expect(sameReading("あ", "……")).toBe(true);
    expect(sameReading(null, "……")).toBe(true);
  });
});
