/**
 * The bubble detector reports itself. It used to load on the first page and never touch bootState, so /health and
 * the settings page showed it as not ready on a server where it was enabled, downloaded and working.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { bootState } from "@/boot-state";
import { loadBubbleModel } from "@/services/bubble-service";

const before = Bun.env.BUBBLE_MODELS_DIR;
afterAll(() => {
  if (before === undefined) delete Bun.env.BUBBLE_MODELS_DIR;
  else Bun.env.BUBBLE_MODELS_DIR = before;
  bootState.bubbleReady = false;
});

describe("loading the bubble detector at boot", () => {
  test("says so when the model isn't there, and claims nothing", async () => {
    Bun.env.BUBBLE_MODELS_DIR = join(import.meta.dir, "no-such-models-dir");
    bootState.bubbleReady = false;
    await expect(loadBubbleModel()).rejects.toThrow(/not found/);
    // Boot only warns about this one, so the flag is what tells anybody the detector is missing
    expect(bootState.bubbleReady).toBe(false);
  });
});
