/**
 * Structured logger built on pino.
 *
 * Outputs:
 *  - Colourful, human-readable lines to stdout (pino-pretty).
 *  - Structured JSON to <DATA_DIR>/logs/server.<date>.<n>.log — a file per day, a new number past 10 MB, and
 *    a fortnight kept (pino-roll).
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Server started");
 *   logger.error({ err }, "Something failed");
 *   logger.child({ module: "ocr" }).info("Model loaded");
 */

import pino from "pino";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// Read directly rather than through env.ts, so the logger stays importable from anywhere without a cycle
const LOG_DIR = `${Bun.env.DATA_DIR ?? "./data"}/logs`;
mkdirSync(LOG_DIR, { recursive: true });

/** How many days of logs to keep. */
const KEEP_DAYS = 14;

/** A log this module wrote: server.<date>.<number>.log, and nothing else in the folder. */
const LOG_FILE = /^server\.(\d{4}-\d{2}-\d{2})\.\d+\.log$/;

/**
 * Clears logs older than a fortnight, at startup.
 *
 * pino-roll's own limit only runs when it rolls a file, which happens at midnight or past 10 MB — so a server
 * restarted through the day, as a development one is, never reaches it and keeps every log it has ever written.
 * Sweeping here instead means the limit holds however the server is run. Only this module's own dated files are
 * touched; anything else in the folder is somebody else's business.
 */
export function sweepOldLogs(dir: string, keepDays = KEEP_DAYS, now = new Date()): string[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - keepDays);
  const oldest = cutoff.toISOString().slice(0, 10);
  const removed: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      const dated = LOG_FILE.exec(name);
      // ISO dates compare as text, so this is simply "before the cutoff day"
      if (!dated || dated[1]! >= oldest) continue;
      try {
        unlinkSync(join(dir, name));
        removed.push(name);
      } catch {
        // Held open, or not ours to remove: it can go next time
      }
    }
  } catch {
    // No log folder yet: nothing to sweep
  }
  return removed;
}

/**
 * Where the log file goes and when it gives way to the next one.
 *
 * `file` is the name without its extension, and `extension` is given separately: pino-roll takes an extension off
 * the file name if it finds one there, and then the extension passed here is discarded — which is how a file meant
 * to be dated ended up as plain `server.1.log`.
 *
 * `dateFormat` is what actually makes a file per day. Without it, a new day only starts a new file if the process
 * happens to still be running at midnight, so a server restarted through the day appends to the same file for
 * ever. With it, the name is decided from the date at startup, so a restart on a new day opens a new file.
 *
 * `removeOtherLogFiles` makes the fortnight's limit count the files on disk rather than the ones this run created.
 * Without it a restart forgets everything older, and nothing is ever cleared away.
 */
export function rollingFileOptions(dir: string): Record<string, unknown> {
  return {
    file: `${dir}/server`,
    extension: ".log",
    dateFormat: "yyyy-MM-dd",
    frequency: "daily",
    size: "10m",
    limit: { count: 14, removeOtherLogFiles: true },
    mkdir: true,
  };
}

const isDev = (Bun.env.NODE_ENV ?? "development") !== "production";
/**
 * A test run logs warnings and worse only: an info line per request would bury the one failure worth reading. Still
 * written, so a failing test's server-side complaint is there to see.
 */
const isTest = Bun.env.NODE_ENV === "test";
const consoleLevel = isTest ? "warn" : isDev ? "debug" : "info";

sweepOldLogs(LOG_DIR);

const transport = pino.transport({
  targets: [
    // ── Colourful terminal ──────────────────────────────────────────────────
    {
      target: "pino-pretty",
      level: consoleLevel,
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
        messageFormat: "{module} {msg}",
        errorLikeObjectKeys: ["err", "error"],
      },
    },
    // ── Rotating JSON file ──────────────────────────────────────────────────
    {
      target: "pino-roll",
      level: "info",
      options: rollingFileOptions(LOG_DIR),
    },
  ],
});

export const logger = pino(
  {
    // The lowest level any target wants: the root filters first, so a higher level here would starve the file
    level: isDev ? "debug" : "info",
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  },
  transport,
);

/** Returns a child logger tagged with a module name (shown in terminal). */
export function childLogger(module: string): pino.Logger {
  return logger.child({ module: `[${module}]` });
}
