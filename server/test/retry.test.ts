/**
 * Trying again, and — more importantly — not trying again.
 *
 * The distinction is the whole point: a 429 or a container still loading is weather, and the same request works a
 * moment later; an answer nobody understands is a fault, and asking twice only hides it behind a longer wait.
 */
import { describe, expect, test } from "bun:test";
import { retryAfterMs, Transient, withRetry } from "@/lib/retry";

describe("trying again", () => {
  test("a transient failure is retried until it works", async () => {
    let tries = 0;
    const result = await withRetry(async () => {
      tries++;
      if (tries < 3) throw new Transient("still warming up");
      return "translated";
    }, { baseMs: 1 });
    expect(result).toBe("translated");
    expect(tries).toBe(3);
  });

  test("a fault is not retried, however often it would be allowed", async () => {
    let tries = 0;
    const attempt = withRetry(async () => {
      tries++;
      throw new Error("answered in a shape this doesn't understand");
    }, { attempts: 5, baseMs: 1 });
    await expect(attempt).rejects.toThrow(/shape/);
    // Once. Asking again would take longer to produce the same answer, and bury the reason
    expect(tries).toBe(1);
  });

  test("gives up after the attempts allowed, with the failure that ended it", async () => {
    let tries = 0;
    const attempt = withRetry(async () => {
      tries++;
      throw new Transient(`attempt ${tries} failed`);
    }, { attempts: 3, baseMs: 1 });
    await expect(attempt).rejects.toThrow(/attempt 3 failed/);
    expect(tries).toBe(3);
  });

  test("a caller who has given up is not kept waiting", async () => {
    const giveUp = new AbortController();
    let tries = 0;
    const attempt = withRetry(async () => {
      tries++;
      giveUp.abort(new Error("the job was cancelled"));
      throw new Transient("would be worth another try, in other circumstances");
    }, { attempts: 5, baseMs: 10_000, signal: giveUp.signal });
    await expect(attempt).rejects.toThrow();
    // Straight out, without the ten-second sleep it would otherwise have taken
    expect(tries).toBe(1);
  });

  test("a server that names its own wait is obeyed, within reason", async () => {
    const waits: number[] = [];
    let tries = 0;
    await withRetry(async () => {
      tries++;
      if (tries === 1) throw new Transient("slow down", 30);
      return "ok";
    }, { baseMs: 1, onRetry: ({ waitMs }) => waits.push(waitMs) });
    expect(waits).toEqual([30]);

    // …but not past the cap, whatever it asks for
    const capped: number[] = [];
    let second = 0;
    await withRetry(async () => {
      second++;
      if (second === 1) throw new Transient("come back tomorrow", 86_400_000);
      return "ok";
    }, { baseMs: 1, maxWaitMs: 5, onRetry: ({ waitMs }) => capped.push(waitMs) });
    expect(capped).toEqual([5]);
  });

  test("waits grow, and carry jitter so a page's blocks don't march back in step", async () => {
    const waits: number[] = [];
    let tries = 0;
    await withRetry(async () => {
      tries++;
      if (tries < 4) throw new Transient("busy");
      return "ok";
    }, { attempts: 4, baseMs: 100, onRetry: ({ waitMs }) => waits.push(waitMs) });
    expect(waits).toHaveLength(3);
    // Full jitter: each wait sits anywhere inside its own window, and the windows double
    expect(waits[0]).toBeLessThanOrEqual(100);
    expect(waits[1]).toBeLessThanOrEqual(200);
    expect(waits[2]).toBeLessThanOrEqual(400);
  });
});

describe("what a server asked for", () => {
  test("reads seconds, a date, or nothing at all", () => {
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("0")).toBe(0);
    const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
    const fromDate = retryAfterMs(inTenSeconds) ?? 0;
    expect(fromDate).toBeGreaterThan(8_000);
    expect(fromDate).toBeLessThanOrEqual(11_000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("soon please")).toBeUndefined();
    // A date already past is no wait at all, rather than a negative one
    expect(retryAfterMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });
});
