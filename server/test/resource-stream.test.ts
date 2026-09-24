/**
 * The machine's readings, streamed to whoever is watching — and only while they are.
 */
import { describe, expect, test } from "bun:test";
import { policyFor } from "@/plugins/auth/guard";
import { sampleResources, watchResources } from "@/services/resource-monitor";
import { runExclusiveResult } from "@/queue/page-queue";

describe("a reading of the machine", () => {
  test("says what it can, and admits what it can't", () => {
    const sample = sampleResources();
    expect(sample.rss).toBeGreaterThan(1_000_000);
    expect(sample.cores).toBeGreaterThan(0);
    expect(sample.cpu).toBeGreaterThanOrEqual(0);
    // Either a reading or null: never a zero standing in for "no GPU here"
    expect(sample.gpu === null || (sample.gpu >= 0 && sample.gpu <= 100)).toBe(true);
  });

  test("names the work the server is doing while it does it", async () => {
    expect(sampleResources().work).toBeNull();
    const during = await runExclusiveResult(async () => sampleResources().work, "page abc ocr");
    expect(during).toBe("page abc ocr");
    // …and stops naming it once the work is over, including when it failed
    expect(sampleResources().work).toBeNull();
    await runExclusiveResult(async () => { throw new Error("no"); }, "page abc render").catch(() => {});
    expect(sampleResources().work).toBeNull();
  });
});

describe("watching", () => {
  test("delivers samples, and stops when the last watcher leaves", async () => {
    const seen: number[] = [];
    const stop = watchResources((sample) => seen.push(sample.at));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    stop();
    expect(seen.length).toBeGreaterThanOrEqual(1);

    const after = seen.length;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // Nobody is watching, so nothing is sampled
    expect(seen.length).toBe(after);
  });
});

describe("who may watch", () => {
  test("a contributor in a browser, not an API key", () => {
    expect(policyFor("/api/resources/events")).toBe("contributor");
  });
});
