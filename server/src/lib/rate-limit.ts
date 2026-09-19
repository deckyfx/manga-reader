/**
 * Fixed-window counters per key, in memory. Enough for one server process: the aim is to keep a guesser from running
 * unbounded password checks, not to meter traffic across a fleet.
 */
export class RateLimiter {
  /** Kept in window order (a renewed window moves to the back), so the front is always the first to expire. */
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  /**
   * @param limit    requests allowed per key in one window
   * @param windowMs length of the window
   * @param maxKeys  keys remembered at once; past it the oldest window is dropped, so a flood of new addresses
   *                 costs bounded memory
   */
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 10_000) {}

  /** Counts one request against `key`; false once the key has used up its window. */
  take(key: string): boolean {
    const now = Date.now();
    // Expired windows sit at the front: dropping them costs nothing per request on average
    for (const [k, w] of this.windows) {
      if (w.resetAt > now) break;
      this.windows.delete(k);
    }
    let window = this.windows.get(key);
    if (!window) {
      if (this.windows.size >= this.maxKeys) {
        const oldest = this.windows.keys().next();
        if (!oldest.done) this.windows.delete(oldest.value);
      }
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
