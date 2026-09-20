/**
 * The scan log: what it records, who may read it, and what it forgets.
 *
 * The invariant worth pinning down is the second one — everyone reads their own scans, and only an admin reads
 * everyone's, whatever the request asks for.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "@/db/index";
import { regionScans } from "@/db/schema";
import { ScanStore } from "@/stores/scan-store";
import { call, signedIn } from "./harness";

/** A scan as if POST /ocr had just run one for this account. */
const scanned = (userId: number, username: string, text: string, translated: string | null = null) =>
  ScanStore.insert({ userId, username, sourceText: text, translatedText: translated, translateEngine: translated ? "deepl" : "none", elapsedMs: 12 });

describe("reading the scan log", () => {
  test("everyone reads their own, and an admin reads everyone's", async () => {
    const mine = await signedIn("contributor");
    const theirs = await signedIn("contributor");
    const admin = await signedIn("admin");
    await scanned(mine.id, mine.username, "私のスキャン");
    await scanned(theirs.id, theirs.username, "誰かのスキャン");

    const own = await call<{ username: string }[]>("GET", "/manage/api/scans", undefined, { cookie: mine.cookie });
    expect(own.status).toBe(200);
    expect(own.body.every((scan) => scan.username === mine.username)).toBe(true);

    // Asking for somebody else's scans reads your own: the filter is the permission, not a suggestion
    const askedForTheirs = await call<{ username: string }[]>("GET", `/manage/api/scans?user=${theirs.id}`, undefined, { cookie: mine.cookie });
    expect(askedForTheirs.body.every((scan) => scan.username === mine.username)).toBe(true);

    const everyone = await call<{ username: string }[]>("GET", "/manage/api/scans", undefined, { cookie: admin.cookie });
    const names = new Set(everyone.body.map((scan) => scan.username));
    expect(names.has(mine.username)).toBe(true);
    expect(names.has(theirs.username)).toBe(true);

    // And an admin may still narrow it to one account
    const narrowed = await call<{ username: string }[]>("GET", `/manage/api/scans?user=${theirs.id}`, undefined, { cookie: admin.cookie });
    expect(narrowed.body.every((scan) => scan.username === theirs.username)).toBe(true);
  });

  test("a guest reads nothing", async () => {
    expect((await call("GET", "/manage/api/scans")).status).toBe(401);
  });

  test("the search matches the text or its translation, and % is text rather than a wildcard", async () => {
    const me = await signedIn("contributor");
    await scanned(me.id, me.username, "ねこ", "a cat");
    await scanned(me.id, me.username, "100% sure");

    const bySource = await call<unknown[]>("GET", "/manage/api/scans?q=" + encodeURIComponent("ねこ"), undefined, { cookie: me.cookie });
    expect(bySource.body).toHaveLength(1);
    const byTranslation = await call<unknown[]>("GET", "/manage/api/scans?q=a%20cat", undefined, { cookie: me.cookie });
    expect(byTranslation.body).toHaveLength(1);
    const wildcard = await call<unknown[]>("GET", "/manage/api/scans?q=" + encodeURIComponent("100%"), undefined, { cookie: me.cookie });
    expect(wildcard.body).toHaveLength(1);
  });

  test("paging walks back without repeating a row", async () => {
    const me = await signedIn("contributor");
    for (let i = 0; i < 5; i++) await scanned(me.id, me.username, `page ${i}`);

    const first = await call<{ id: number }[]>("GET", "/manage/api/scans?limit=2", undefined, { cookie: me.cookie });
    expect(first.body).toHaveLength(2);
    const next = await call<{ id: number }[]>("GET", `/manage/api/scans?limit=2&before_id=${first.body[1].id}`, undefined, { cookie: me.cookie });
    expect(next.body).toHaveLength(2);
    expect(next.body[0].id).toBeLessThan(first.body[1].id);
    expect(new Set([...first.body, ...next.body].map((scan) => scan.id)).size).toBe(4);
  });
});

describe("what the log keeps", () => {
  test("a scan outlives the account that ran it", async () => {
    const admin = await signedIn("admin");
    const leaving = await signedIn("contributor");
    await scanned(leaving.id, leaving.username, "残る");

    expect((await call("DELETE", `/manage/api/users/${leaving.id}`, undefined, { cookie: admin.cookie })).status).toBe(200);

    const after = await call<{ username: string; user_id: number | null }[]>(
      "GET", "/manage/api/scans?q=" + encodeURIComponent("残る"), undefined, { cookie: admin.cookie },
    );
    expect(after.body).toHaveLength(1);
    // The account is gone, so the id goes with it; the name stays, so the row still reads as somebody
    expect(after.body[0].user_id).toBeNull();
    expect(after.body[0].username).toBe(leaving.username);
  });

  test("the sweep drops what is past its retention, and 0 days keeps everything", async () => {
    const me = await signedIn("contributor");
    const old = await scanned(me.id, me.username, "古い");
    await scanned(me.id, me.username, "新しい");
    await db.update(regionScans).set({ createdAt: sql`datetime('now', '-30 days')` }).where(sql`id = ${old.id}`);

    expect(await ScanStore.purgeOlderThan(7)).toBe(1);
    expect(await ScanStore.purgeOlderThan(0)).toBe(0);
    const left = await ScanStore.list({ userId: me.id });
    expect(left.map((scan) => scan.sourceText)).toEqual(["新しい"]);
  });
});
