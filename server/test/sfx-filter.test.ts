/**
 * Page numbers and texture specks the detector takes for sound effects start out of cleaning; real sound effects,
 * big or small, anywhere on the page, still get cleaned.
 */
import { describe, expect, test } from "bun:test";
import { sfxExclusion } from "@/services/sfx-filter";

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
