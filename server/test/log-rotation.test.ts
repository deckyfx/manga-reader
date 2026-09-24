/**
 * The log file is dated and gives way to the next one.
 *
 * Tested against pino-roll itself rather than against the options object, because the bug this replaces was one the
 * options *looked* right for: a `file` ending in `.log` makes pino-roll take the extension from the name and throw
 * away the one passed alongside, and without `dateFormat` the date never reaches the name at all. Only the file
 * that ends up on disk shows that.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rollingFileOptions, sweepOldLogs } from "@/lib/logger";

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "web-ocr-logs-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Writes a line through pino-roll into `dir` and returns what it left there. */
async function writeLog(dir: string): Promise<string[]> {
  const { default: pinoRoll } = await import("pino-roll");
  const stream = await pinoRoll(rollingFileOptions(dir));
  stream.write(`${JSON.stringify({ level: 30, msg: "hello" })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 60));
  stream.end();
  return readdirSync(dir);
}

describe("the rotating log file", () => {
  test("carries the date, so each day has its own", async () => {
    const files = await writeLog(scratch());
    expect(files).toHaveLength(1);
    // server.2026-09-23.1.log — the date is the part that was missing
    expect(files[0]).toMatch(/^server\.\d{4}-\d{2}-\d{2}\.1\.log$/);
    // The local day, which is how pino-roll names it — near midnight the UTC one is a different date
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(files[0]).toContain(today);
  });

  test("a fortnight is kept and the rest swept, however the server is run", () => {
    const dir = scratch();
    // Twenty days of logs left by runs that ended long ago, as a server restarted through the day leaves behind
    for (let day = 1; day <= 20; day++) {
      writeFileSync(join(dir, `server.2026-09-${String(day).padStart(2, "0")}.1.log`), "old\n");
    }
    const removed = sweepOldLogs(dir, 14, new Date("2026-09-20T12:00:00Z"));
    const left = readdirSync(dir).sort();
    // A fortnight back from the 20th is the 6th: everything before it goes, and the day itself stays
    expect(removed.sort()).toEqual(["server.2026-09-01.1.log", "server.2026-09-02.1.log", "server.2026-09-03.1.log", "server.2026-09-04.1.log", "server.2026-09-05.1.log"]);
    expect(left).toHaveLength(15);
    expect(left[0]).toBe("server.2026-09-06.1.log");
    expect(left).toContain("server.2026-09-20.1.log");
  });

  test("measures the fortnight by the local day, as the file name does", () => {
    const dir = scratch();
    // Just after midnight in Jakarta is still the day before in UTC: the file is named for the local day, so the
    // cutoff has to be read the same way or a day's logs go early (or late, west of Greenwich)
    for (const day of ["01", "02", "03"]) writeFileSync(join(dir, `server.2026-09-${day}.1.log`), "old\n");
    const justAfterMidnightLocal = new Date("2026-09-16T00:30:00");
    expect(sweepOldLogs(dir, 14, justAfterMidnightLocal)).toEqual(["server.2026-09-01.1.log"]);
    expect(readdirSync(dir).sort()).toEqual(["server.2026-09-02.1.log", "server.2026-09-03.1.log"]);
  });

  test("leaves retention to the sweep, not to a count of files", () => {
    // pino-roll's limit counts files, and a busy day can roll several: keeping "14 files" would throw away
    // yesterday to keep four of today's
    expect(rollingFileOptions("/tmp/x")).not.toHaveProperty("limit");
  });

  test("sweeps only its own logs, and survives a folder that isn't there", () => {
    const dir = scratch();
    writeFileSync(join(dir, "server.1.log"), "from an older build\n");
    writeFileSync(join(dir, "notes.txt"), "someone else's\n");
    writeFileSync(join(dir, "server.2020-01-01.1.log"), "ancient\n");
    expect(sweepOldLogs(dir)).toEqual(["server.2020-01-01.1.log"]);
    expect(readdirSync(dir).sort()).toEqual(["notes.txt", "server.1.log"]);
    expect(sweepOldLogs(join(dir, "gone"))).toEqual([]);
  });
});
