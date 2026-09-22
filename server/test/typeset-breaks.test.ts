/**
 * Line breaks typed into a block's lettering are kept: the typesetter starts a new line there instead of wrapping the
 * text as if the break weren't in it.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { rectArea, Typesetter } from "@/shared/typeset";
import { FONT_FILES } from "@/services/typeset-service";

let typesetter: Typesetter;

beforeAll(async () => {
  const [regular, bold, italic] = await Promise.all(
    (["regular", "bold", "italic"] as const).map((variant) => Bun.file(FONT_FILES[variant]).arrayBuffer()),
  );
  typesetter = Typesetter.fromBuffers({ regular, bold, italic });
});

/** A plain rectangular bubble, wide enough to hold the test phrases on one line. */
const area = () => rectArea({ x: 0, y: 0, w: 900, h: 300 }, false);
const lines = (text: string) => typesetter.layout(text, area(), 40).lines.map((line) => line.text);

describe("typed line breaks", () => {
  test("without one, the text wraps to fit", () => {
    expect(lines("Hello there friend")).toEqual(["HELLO THERE FRIEND"]);
  });

  test("a break starts a new line, even with room left on the one before", () => {
    expect(lines("Hello there\nfriend")).toEqual(["HELLO THERE", "FRIEND"]);
    expect(lines("One\nTwo\nThree")).toEqual(["ONE", "TWO", "THREE"]);
  });

  test("blank lines and stray spaces around a break don't make empty lines", () => {
    expect(lines("Hello\n\n\nthere")).toEqual(["HELLO", "THERE"]);
    expect(lines("  Hello  \n  there  ")).toEqual(["HELLO", "THERE"]);
    expect(lines("\nHello there\n")).toEqual(["HELLO THERE"]);
  });

  test("each part still wraps on its own when it is too long for the bubble", () => {
    const wrapped = lines("Hello there my old friend how are you today\nBye");
    expect(wrapped.at(-1)).toBe("BYE");
    expect(wrapped.length).toBeGreaterThan(2);
  });

  test("windows line endings count as one break", () => {
    expect(lines("Hello\r\nthere")).toEqual(["HELLO", "THERE"]);
  });
});
