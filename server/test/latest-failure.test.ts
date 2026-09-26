/**
 * Which failure a screen shows when it has several things that can fail.
 *
 * The API keys page has three: create, revoke, remove. It used to show them in a fixed order, so a creation that
 * failed earlier outranked the removal that failed just now — and the row that stayed in the list was explained by
 * the wrong sentence, or by one about something else entirely.
 */
import { describe, expect, test } from "bun:test";
import { latestFailure, type Attempt } from "../client/lib/latest-failure";

const ok = (at: number): Attempt => ({ at, error: null });
const failed = (at: number, message: string): Attempt => ({ at, error: new Error(message) });
const idle = (): Attempt => ({ at: 0, error: null });

describe("choosing the failure to show", () => {
  test("nothing attempted, nothing to say", () => {
    expect(latestFailure([idle(), idle(), idle()])).toBeNull();
  });

  test("the only failure there is", () => {
    expect(latestFailure([idle(), failed(5, "revoke refused"), idle()])?.message).toBe("revoke refused");
  });

  /** The case from the review: an old creation error must not explain a removal that just failed. */
  test("the most recent failure wins, whatever order they are given in", () => {
    const attempts = [failed(1, "could not create"), idle(), failed(9, "could not remove")];
    expect(latestFailure(attempts)?.message).toBe("could not remove");
    expect(latestFailure([...attempts].reverse())?.message).toBe("could not remove");
  });

  /** And the other half of it: something that worked afterwards clears the banner. */
  test("a later success says nothing, rather than leaving the old error up", () => {
    expect(latestFailure([failed(1, "could not create"), ok(9)])).toBeNull();
  });

  test("an earlier success doesn't hide a later failure", () => {
    expect(latestFailure([ok(1), failed(9, "could not remove")])?.message).toBe("could not remove");
  });

  test("something never run is ignored, even though its timestamp is the smallest possible", () => {
    // A mutation that has never been submitted reads as 0, which must not count as "the earliest attempt".
    expect(latestFailure([idle(), failed(3, "the only one that ran")])?.message).toBe("the only one that ran");
  });

  test("two failures in the same millisecond: one of them, and no crash", () => {
    const chosen = latestFailure([failed(7, "first"), failed(7, "second")]);
    expect(chosen).not.toBeNull();
    expect(["first", "second"]).toContain(chosen!.message);
  });

  test("an empty list is not an error", () => {
    expect(latestFailure([])).toBeNull();
  });
});
