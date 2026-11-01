/**
 * What the mouse wheel does in the Studio's page views (client/studio/canvas/wheel.ts): the editing canvas and the
 * stage comparison both read their wheel events through this, so these are the rules for both.
 */
import { describe, expect, test } from "bun:test";
import { wheelIntent, type WheelInput } from "../client/studio/canvas/wheel";

const wheel = (input: Partial<WheelInput>): WheelInput => ({
  deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...input,
});

/** A zoom intent's percentage change, rounded: +10 means 10% larger. */
const zoomPercent = (intent: ReturnType<typeof wheelIntent>): number | null =>
  "zoom" in intent ? Math.round((intent.zoom - 1) * 1000) / 10 : null;

describe("in zoom mode", () => {
  test("one wheel notch towards you zooms in 10%, away zooms out by the same step", () => {
    expect(zoomPercent(wheelIntent(wheel({ deltaY: -100 }), "zoom", 800))).toBe(10);
    const out = wheelIntent(wheel({ deltaY: 100 }), "zoom", 800);
    expect("zoom" in out && Math.round(out.zoom * 1.1 * 1000) / 1000).toBe(1);
  });

  test("Shift scrolls up and down instead, whichever axis the browser put the delta on", () => {
    expect(wheelIntent(wheel({ deltaY: 100, shiftKey: true }), "zoom", 800)).toEqual({ pan: { dx: 0, dy: 100 } });
    expect(wheelIntent(wheel({ deltaX: 100, shiftKey: true }), "zoom", 800)).toEqual({ pan: { dx: 0, dy: 100 } });
  });
});

describe("in the scrolling modes", () => {
  test("vertical scrolls up and down; Shift scrolls sideways", () => {
    expect(wheelIntent(wheel({ deltaY: 100 }), "vertical", 800)).toEqual({ pan: { dx: 0, dy: 100 } });
    expect(wheelIntent(wheel({ deltaY: 100, shiftKey: true }), "vertical", 800)).toEqual({ pan: { dx: 100, dy: 0 } });
  });

  test("horizontal scrolls sideways; Shift scrolls up and down", () => {
    expect(wheelIntent(wheel({ deltaY: 100 }), "horizontal", 800)).toEqual({ pan: { dx: 100, dy: 0 } });
    expect(wheelIntent(wheel({ deltaY: -100, shiftKey: true }), "horizontal", 800)).toEqual({ pan: { dx: 0, dy: -100 } });
  });

  test("a trackpad swipe on both axes moves freely, in either scrolling mode", () => {
    for (const mode of ["vertical", "horizontal"] as const) {
      expect(wheelIntent(wheel({ deltaX: 30, deltaY: -20 }), mode, 800)).toEqual({ pan: { dx: 30, dy: -20 } });
    }
  });
});

describe("in every mode", () => {
  test("Ctrl or Cmd + wheel zooms, which is also how a trackpad pinch arrives", () => {
    for (const mode of ["zoom", "vertical", "horizontal"] as const) {
      expect(zoomPercent(wheelIntent(wheel({ deltaY: -100, ctrlKey: true }), mode, 800))).toBe(10);
      expect(zoomPercent(wheelIntent(wheel({ deltaY: -100, metaKey: true }), mode, 800))).toBe(10);
    }
  });

  test("lines and pages are read as pixels, and a flick is capped so it can't jump several levels", () => {
    // Firefox reports lines: 3 lines are 48 pixels
    expect(wheelIntent(wheel({ deltaY: 3, deltaMode: 1 }), "vertical", 800)).toEqual({ pan: { dx: 0, dy: 48 } });
    // A page is the view's height, capped at 300
    expect(wheelIntent(wheel({ deltaY: 1, deltaMode: 2 }), "vertical", 800)).toEqual({ pan: { dx: 0, dy: 300 } });
    expect(wheelIntent(wheel({ deltaY: 5000 }), "vertical", 800)).toEqual({ pan: { dx: 0, dy: 300 } });
    // Zooming too: capped at 300 pixels, three notches' worth, 1.1³
    expect(zoomPercent(wheelIntent(wheel({ deltaY: -5000 }), "zoom", 800))).toBe(33.1);
  });
});
