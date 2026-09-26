/**
 * Which failure a screen should be showing when several things can go wrong on it.
 *
 * A mutation keeps its error until it is run again or reset, so a page with three of them accumulates stale ones:
 * take them in a fixed order and a creation that failed ten minutes ago outranks the removal that failed just now,
 * which leaves the row sitting there explained by the wrong sentence. Recency is the rule people expect — the
 * banner answers "what happened to the thing I just did", and says nothing when that thing worked.
 */

/** One attempt: when it was submitted (0 if never), and what it failed with (null if it didn't). */
export interface Attempt {
  at: number;
  error: Error | null;
}

/**
 * The error of the most recently submitted attempt, or null when that one succeeded, is still running, or nothing
 * has been attempted at all. Ties go to the earlier argument, which only matters for attempts submitted in the same
 * millisecond — and then either answer is as true as the other.
 *
 * Something never submitted needs no special case: its timestamp is the smallest there is, so anything real
 * outranks it, and if it does win there was no error to report anyway.
 */
export function latestFailure(attempts: Attempt[]): Error | null {
  let latest: Attempt | null = null;
  for (const attempt of attempts) {
    if (latest === null || attempt.at > latest.at) latest = attempt;
  }
  return latest?.error ?? null;
}
