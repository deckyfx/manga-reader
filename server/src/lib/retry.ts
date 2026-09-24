/**
 * Trying again, for the failures worth trying again for.
 *
 * A translator on the other side of the network fails in two different ways, and they deserve opposite answers. A
 * 429, a 503, a connection that never opened — those are weather: the same request a second later usually works.
 * An answer in a shape nobody understands, or one with the wrong number of translations in it, is a fault: asking
 * again produces the same thing, more slowly, and hides the bug.
 *
 * So only what an attempt marks as {@link Transient} is retried. Everything else goes straight to the caller.
 */

/** A failure worth trying again. `retryAfterMs` carries a server's own instruction, where it gave one. */
export class Transient extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "Transient";
  }
}

export interface RetryOptions {
  /** How many times to try in total, the first attempt included. */
  attempts?: number;
  /** The wait before the second attempt; each later one waits about twice as long. */
  baseMs?: number;
  /** No single wait longer than this, whatever the server asks for. */
  maxWaitMs?: number;
  /** The caller's cancellation: a job nobody is waiting for shouldn't sleep, let alone try again. */
  signal?: AbortSignal;
  /** Told about each wait, for a log line that explains a slow stage. */
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
}

/** Sleeps, unless the caller gives up first — in which case it stops there. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `attempt`, and runs it again while it throws {@link Transient} and attempts remain.
 *
 * Waits grow — roughly doubling — and carry jitter, so a page's blocks that all failed at once don't march back
 * in step. A server that named its own wait is obeyed, up to `maxWaitMs`.
 */
export async function withRetry<T>(attempt: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseMs = 500, maxWaitMs = 10_000, signal, onRetry } = options;
  for (let tries = 1; ; tries++) {
    try {
      return await attempt();
    } catch (err) {
      const transient = err instanceof Transient;
      // The last attempt's failure is the caller's, whatever kind it was; so is anything not worth repeating
      if (!transient || tries >= attempts) throw err;
      if (signal?.aborted) throw err;
      const asked = err.retryAfterMs;
      // Full jitter: somewhere between none and the whole window, so retries spread rather than pile up
      const window = Math.min(maxWaitMs, baseMs * 2 ** (tries - 1));
      const waitMs = Math.round(asked !== undefined ? Math.min(asked, maxWaitMs) : Math.random() * window);
      onRetry?.({ attempt: tries, waitMs, reason: err.message });
      await pause(waitMs, signal);
    }
  }
}

/** A `Retry-After` header in milliseconds: seconds, or an HTTP date. Undefined when it says nothing usable. */
export function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(header);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - Date.now());
}
