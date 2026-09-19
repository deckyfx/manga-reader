/**
 * Fixed-window counters per key, in memory. Enough for one server process: the aim is to keep a guesser from running
 * unbounded password checks, not to meter traffic across a fleet.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  /**
   * @param limit    requests allowed per key in one window
   * @param windowMs length of the window
   */
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Counts one request against `key`; false once the key has used up its window. */
  take(key: string): boolean {
    const now = Date.now();
    // Forgotten windows would otherwise pile up, one per address ever seen
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count++;
    return window.count <= this.limit;
  }

  /** Forgets a key, e.g. after a successful sign-in. */
  reset(key: string): void {
    this.windows.delete(key);
  }
}
