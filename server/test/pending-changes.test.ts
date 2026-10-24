/**
 * The page tuning panel's saving (client/lib/pending-changes.ts): edits close together go out as one, nothing
 * waiting is lost or sent to the wrong page, and nothing waiting outlives a reset.
 */
import { describe, expect, test } from "bun:test";
import { PendingChanges } from "../client/lib/pending-changes";

type Knobs = { a?: number | null; b?: number | null };
const DELAY = 20;

function recorder() {
  const sent: [string, Knobs][] = [];
  return { sent, pending: new PendingChanges<Knobs>((id, changes) => sent.push([id, changes]), DELAY) };
}

describe("pending changes", () => {
  test("edits close together are saved once, with the last value of each", async () => {
    const { sent, pending } = recorder();
    pending.change("p1", "a", 2);
    pending.change("p1", "a", 24);
    pending.change("p1", "b", 6);
    expect(sent).toEqual([]);
    await Bun.sleep(DELAY * 3);
    expect(sent).toEqual([["p1", { a: 24, b: 6 }]]);
  });

  test("a flush sends what is waiting at once, and only once", async () => {
    const { sent, pending } = recorder();
    pending.change("p1", "a", 30);
    pending.flush();
    expect(sent).toEqual([["p1", { a: 30 }]]);
    await Bun.sleep(DELAY * 3);
    pending.flush();
    expect(sent).toEqual([["p1", { a: 30 }]]);
  });

  test("an edit on another page first sends the last page's, to that page", () => {
    const { sent, pending } = recorder();
    pending.change("p1", "a", 30);
    pending.change("p2", "b", 4);
    expect(sent).toEqual([["p1", { a: 30 }]]);
    pending.flush();
    expect(sent).toEqual([["p1", { a: 30 }], ["p2", { b: 4 }]]);
  });

  test("a discard forgets what was waiting, so it can't land after a reset", async () => {
    const { sent, pending } = recorder();
    pending.change("p1", "a", 30);
    pending.discard();
    await Bun.sleep(DELAY * 3);
    pending.flush();
    expect(sent).toEqual([]);
  });

  test("clearing a value is an edit like any other", async () => {
    const { sent, pending } = recorder();
    pending.change("p1", "a", null);
    await Bun.sleep(DELAY * 3);
    expect(sent).toEqual([["p1", { a: null }]]);
  });

  // Spaced edits need room on the clock: 100 ms waits, edits 50 ms apart, so every margin is 30 ms or more
  test("each edit restarts the wait, so edits spaced closer than it still go out as one", async () => {
    const sent: [string, Knobs][] = [];
    const pending = new PendingChanges<Knobs>((id, changes) => sent.push([id, changes]), 100);
    pending.change("p1", "a", 2);
    await Bun.sleep(50);
    pending.change("p1", "a", 24);
    await Bun.sleep(80);
    // 130 ms after the first edit: a wait that wasn't restarted would have sent by now
    pending.change("p1", "b", 6);
    expect(sent).toEqual([]);
    await Bun.sleep(150);
    expect(sent).toEqual([["p1", { a: 24, b: 6 }]]);
  });

  test("an edit after a discard waits its own full delay, not what was left of the old one", async () => {
    const sent: [string, Knobs][] = [];
    const pending = new PendingChanges<Knobs>((id, changes) => sent.push([id, changes]), 100);
    pending.change("p1", "a", 30);
    pending.discard();
    await Bun.sleep(50);
    pending.change("p1", "a", 5);
    await Bun.sleep(80);
    // 130 ms after the discarded edit, 80 after this one: the old wait would have sent it early
    expect(sent).toEqual([]);
    await Bun.sleep(100);
    expect(sent).toEqual([["p1", { a: 5 }]]);
  });
});
