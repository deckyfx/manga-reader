/**
 * What a piece of work cost the machine. The arithmetic is pinned here — a peak that is really an average, or an
 * average that quietly means "of the samples we happened to take", would be worse than no number at all.
 */
import { describe, expect, test } from "bun:test";
import { describeUsage, startProbe, totalUsage, usageFields, type Usage } from "@/lib/resource-probe";

/** A Usage with the fields a test cares about, and unremarkable values for the rest. */
function usage(fields: Partial<Usage>): Usage {
  return { wallMs: 1000, cpuMs: 1000, cpuAvg: 100, cpuPeak: 100, rssAvg: 0, rssPeak: 0, gpuAvg: null, gpuPeak: null, vramPeak: null, cores: 8, ...fields };
}

describe("measuring work", () => {
  test("a busy stretch is reported as busy", () => {
    const probe = startProbe();
    const until = Date.now() + 300;
    let n = 0;
    while (Date.now() < until) n += Math.sqrt(n + 1);
    const measured = probe.stop();
    expect(n).toBeGreaterThan(0);

    expect(measured.wallMs).toBeGreaterThan(250);
    // Work on one thread: near a whole core, and nowhere near the whole machine
    expect(measured.cpuMs).toBeGreaterThan(100);
    expect(measured.cpuAvg).toBeGreaterThan(50);
    expect(measured.cpuAvg).toBeLessThan(measured.cores * 100);
    // Memory is the process's own, which is never nothing — this is what the JS heap can't tell you
    expect(measured.rssPeak).toBeGreaterThan(1_000_000);
    expect(measured.rssPeak).toBeGreaterThanOrEqual(measured.rssAvg);
  });

  test("an instant of work still reports rather than dividing by nothing", () => {
    const measured = startProbe().stop();
    expect(Number.isFinite(measured.cpuAvg)).toBe(true);
    expect(measured.rssAvg).toBeGreaterThan(0);
  });

  test("a machine that can't read its GPU says so, rather than saying idle", () => {
    const line = describeUsage(usage({ gpuAvg: null, gpuPeak: null }));
    expect(line).toContain("gpu n/a");
    expect(usageFields(usage({ gpuAvg: null }))).toMatchObject({ gpuAvgPct: null, gpuPeakPct: null });
    // A GPU that answers 0 is a different answer from one that doesn't
    expect(describeUsage(usage({ gpuAvg: 0, gpuPeak: 0 }))).toContain("gpu avg 0%");
  });
});

describe("what a whole run cost", () => {
  const short = usage({ wallMs: 1000, cpuMs: 1000, cpuAvg: 100, cpuPeak: 1200, rssAvg: 1_000_000_000, rssPeak: 3_000_000_000 });
  const long = usage({ wallMs: 9000, cpuMs: 900, cpuAvg: 10, cpuPeak: 20, rssAvg: 2_000_000_000, rssPeak: 2_500_000_000 });

  test("averages follow the time each stage took, not the number of stages", () => {
    const total = totalUsage([short, long]);
    expect(total.wallMs).toBe(10_000);
    // 1900ms of processor over 10s: the nine seconds of idling count for nine times as much as the busy one
    expect(total.cpuAvg).toBeCloseTo(19, 5);
    expect(total.rssAvg).toBeCloseTo(1_900_000_000, -6);
  });

  test("peaks are the highest moment anywhere in the run", () => {
    const total = totalUsage([short, long]);
    expect(total.cpuPeak).toBe(1200);
    expect(total.rssPeak).toBe(3_000_000_000);
  });

  test("a run with no GPU reading keeps null, and one with some averages only those", () => {
    expect(totalUsage([short, long]).gpuAvg).toBeNull();
    const seen = usage({ wallMs: 1000, gpuAvg: 80, gpuPeak: 95, vramPeak: 1_000_000 });
    const blind = usage({ wallMs: 3000, gpuAvg: null, gpuPeak: null });
    const total = totalUsage([seen, blind]);
    expect(total.gpuAvg).toBe(80);
    expect(total.gpuPeak).toBe(95);
  });

  test("nothing at all is not a division by zero", () => {
    const total = totalUsage([]);
    expect(total.wallMs).toBe(0);
    expect(total.cpuAvg).toBe(0);
    expect(total.gpuAvg).toBeNull();
  });
});
