/**
 * Emphasis: lettering the artist drew larger than the rest of the page keeps that proportion in translation, past the
 * page cap if need be, instead of being brought down to the page's shared size. The signal is the original lettering's
 * glyph size, estimated from the detected box and the source text — the same measure in the burn and in the Studio,
 * since both go through typesetPage.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { emphasisScales, pageMaxFontSize, rectArea, sourceGlyphSize, Typesetter, typesetPage, type TypesetEntry } from "@/shared/typeset";
import { FONT_FILES } from "@/services/typeset-service";

let typesetter: Typesetter;

beforeAll(async () => {
  const [regular, bold, italic] = await Promise.all(
    (["regular", "bold", "italic"] as const).map((variant) => Bun.file(FONT_FILES[variant]).arrayBuffer()),
  );
  typesetter = Typesetter.fromBuffers({ regular, bold, italic });
});

const PAGE = { width: 2000, height: 3000 };
const CAP = pageMaxFontSize(PAGE.height);

/** A block whose source of `chars` characters sat in a single vertical column `glyph` pixels wide. */
function entry(id: number, text: string, bubble: { w: number; h: number }, glyph: number, chars = 5, extra: Partial<TypesetEntry> = {}): TypesetEntry {
  return {
    id,
    text,
    area: rectArea({ x: 0, y: 0, ...bubble }, false),
    style: {},
    source: { box: { x: 0, y: 0, w: glyph, h: glyph * chars }, text: "あ".repeat(chars) },
    ...extra,
  };
}

/** Three ordinary bubbles with 50-pixel original lettering, small enough that they set the page size well below the cap. */
const ordinary = (): TypesetEntry[] => [1, 2, 3].map((id) => entry(id, "Is that so", { w: 260, h: 120 }, 50));

describe("measuring the original lettering", () => {
  test("a tight box gives the glyph size, in columns for vertical text and rows for horizontal", () => {
    expect(sourceGlyphSize({ x: 0, y: 0, w: 100, h: 500 }, "あいうえお")).toBe(100);
    // Two columns of five
    expect(sourceGlyphSize({ x: 0, y: 0, w: 200, h: 500 }, "あいうえおかきくけこ")).toBe(100);
    expect(sourceGlyphSize({ x: 0, y: 0, w: 900, h: 90 }, "LOVE LIVE!")).toBe(90);
  });

  test("whitespace isn't lettering, and nothing to measure is null", () => {
    expect(sourceGlyphSize({ x: 0, y: 0, w: 100, h: 500 }, "あい\nうえ お")).toBe(100);
    expect(sourceGlyphSize({ x: 0, y: 0, w: 100, h: 500 }, " \n")).toBeNull();
    expect(sourceGlyphSize({ x: 0, y: 0, w: 0, h: 500 }, "あ")).toBeNull();
  });
});

describe("which blocks are emphasis", () => {
  test("lettering half again as large as the page's is; the page's own is not", () => {
    const scales = emphasisScales([...ordinary(), entry(4, "Stop!", { w: 600, h: 600 }, 90)]);
    expect([...scales.keys()]).toEqual([4]);
    expect(scales.get(4)).toBeCloseTo(1.8, 5);
  });

  test("a short text needs a clearer lead, because the box's padding is most of it", () => {
    // 1.6 times the page's lettering: enough for five characters, not for two
    expect(emphasisScales([...ordinary(), entry(4, "Huh?", { w: 300, h: 300 }, 80, 2)]).has(4)).toBe(false);
    expect(emphasisScales([...ordinary(), entry(4, "Huh?", { w: 300, h: 300 }, 80, 5)]).has(4)).toBe(true);
    expect(emphasisScales([...ordinary(), entry(4, "Huh?", { w: 300, h: 300 }, 95, 2)]).has(4)).toBe(true);
  });

  test("with fewer than three measured blocks there is no 'typical' to stand out from", () => {
    expect(emphasisScales([entry(1, "Is that so", { w: 260, h: 120 }, 50), entry(2, "Stop!", { w: 600, h: 600 }, 150)]).size).toBe(0);
    // A block with no source (a region drawn by hand, a sound effect) isn't counted
    const unmeasured = ordinary().map((e) => ({ ...e, source: undefined }));
    expect(emphasisScales([...unmeasured, entry(4, "Stop!", { w: 600, h: 600 }, 150)]).size).toBe(0);
  });

  test("a fixed size is somebody's decision, and overrides it", () => {
    expect(emphasisScales([...ordinary(), entry(4, "Stop!", { w: 600, h: 600 }, 90, 5, { style: { font_size: 30 } })]).size).toBe(0);
  });
});

describe("lettering an emphasised block", () => {
  test("it keeps its proportion over the page's shared size, which it doesn't move", () => {
    const plain = typesetPage(typesetter, ordinary(), PAGE);
    const page = typesetPage(typesetter, [...ordinary(), entry(4, "Turn it on again!", { w: 900, h: 700 }, 90)], PAGE);
    expect(page.pageFontSize).toBe(plain.pageFontSize);
    expect(page.pageFontSize).toBeLessThan(CAP);

    const shout = page.blocks.find((b) => b.id === 4)!;
    expect(shout.emphasis).toBeCloseTo(1.8, 5);
    expect(shout.layout.fontSize).toBe(Math.round(page.pageFontSize * 1.8));
    expect(shout.layout.fits).toBe(true);
    for (const id of [1, 2, 3]) expect(page.blocks.find((b) => b.id === id)!.emphasis).toBeNull();
  });

  test("nothing else on the page is re-lettered: the shared size stays what it was", () => {
    // Two ordinary bubbles of different room and the shout: leaving the shout out of the median would move it from
    // the roomier bubble's size to the smaller one's, and shrink that bubble's lettering with it
    const entries = [
      entry(1, "Is that so", { w: 220, h: 100 }, 50),
      entry(2, "Is that so", { w: 420, h: 200 }, 50),
      entry(3, "Turn it on again!", { w: 900, h: 700 }, 90),
    ];
    const before = typesetPage(typesetter, entries.map((e) => ({ ...e, source: undefined })), PAGE);
    const after = typesetPage(typesetter, entries, PAGE);
    expect(after.pageFontSize).toBe(before.pageFontSize);
    for (const id of [1, 2]) {
      expect(after.blocks.find((b) => b.id === id)!.layout.fontSize).toBe(before.blocks.find((b) => b.id === id)!.layout.fontSize);
    }
    expect(after.blocks.find((b) => b.id === 3)!.layout.fontSize).toBeGreaterThan(before.blocks.find((b) => b.id === 3)!.layout.fontSize);
  });

  test("it may pass the page cap, up to twice it", () => {
    // Ordinary bubbles roomy enough to reach the cap, and a shout drawn three times their size
    const roomy = [1, 2, 3].map((id) => entry(id, "Hi", { w: 400, h: 300 }, 50));
    const page = typesetPage(typesetter, [...roomy, entry(4, "No!", { w: 1400, h: 900 }, 150)], PAGE);
    expect(page.pageFontSize).toBe(CAP);
    const shout = page.blocks.find((b) => b.id === 4)!;
    expect(shout.layout.fontSize).toBeGreaterThan(CAP);
    expect(shout.layout.fontSize).toBeLessThanOrEqual(2 * CAP);
  });

  test("it still only takes what its bubble has room for", () => {
    const page = typesetPage(typesetter, [...ordinary(), entry(4, "Turn it on again right now!", { w: 260, h: 120 }, 90)], PAGE);
    const shout = page.blocks.find((b) => b.id === 4)!;
    expect(shout.layout.fits).toBe(true);
    expect(shout.layout.fontSize).toBeLessThan(Math.round(page.pageFontSize * 1.8));
  });

  test("without its source measured, it is lettered at the page's size as before", () => {
    const page = typesetPage(typesetter, [...ordinary(), entry(4, "Turn it on again!", { w: 900, h: 700 }, 90, 5, { source: undefined })], PAGE);
    const shout = page.blocks.find((b) => b.id === 4)!;
    expect(shout.emphasis).toBeNull();
    expect(shout.layout.fontSize).toBe(page.pageFontSize);
  });
});
