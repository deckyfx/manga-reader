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
/** How often the sweep runs while the server is up. */
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

/** A date as pino-roll writes it into a file name: the local day, not the UTC one. */
function localDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${String(when.getDate()).padStart(2, "0")}`;
}

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
  // Local time, because that is how pino-roll names the files. Read as UTC, a machine east of Greenwich would
  // measure the fortnight from a different day than the one in the name, and one west of it would sweep a day early
  const oldest = localDay(cutoff);
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
 * No `limit` is passed, deliberately. pino-roll's limit counts *files*, not days, and a busy day can roll several
 * of them past the size cap — so "keep 14" could throw away a log from yesterday while keeping four from today.
 * Age is what this wants to keep, so sweepOldLogs keeps it, by the date in the name.
 */
export function rollingFileOptions(dir: string): Record<string, unknown> {
  return {
    file: `${dir}/server`,
    extension: ".log",
    dateFormat: "yyyy-MM-dd",
    frequency: "daily",
    size: "10m",
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

/**
 * Sweeps now and every day after, until the returned function is called.
 *
 * Startup alone isn't enough: nothing else prunes these — pino-roll only cleans up when it is given a file limit,
 * and a file limit is not an age — so a server left running for a fortnight would keep every log it ever wrote.
 */
export function scheduleLogSweep(dir: string, everyMs = SWEEP_EVERY_MS): () => void {
  sweepOldLogs(dir);
  const timer = setInterval(() => sweepOldLogs(dir), everyMs);
  // Never a reason to keep the process alive for this
  timer.unref?.();
  return () => clearInterval(timer);
}

scheduleLogSweep(LOG_DIR);

/**
 * Whether this is the compiled executable rather than a run from source.
 *
 * It matters because pino's transports are resolved by name, in a worker, when the logger is built — and a
 * compiled binary has no node_modules to resolve them from, so asking for one stops the server before it starts.
 * The binary therefore writes straight to its destinations: the same JSON, without the pretty printing or the
 * rolling, which is the usual shape for something run as a service anyway.
 */
const COMPILED = Bun.main.startsWith("/$bunfs/");

/** Where the compiled binary writes: this boot's dated file, plus stdout for whatever collects it. */
function compiledDestinations(): pino.MultiStreamRes {
  const file = `${LOG_DIR}/server.${localDay(new Date())}.1.log`;
  return pino.multistream([
    { level: consoleLevel as pino.Level, stream: process.stdout },
    { level: "info", stream: pino.destination({ dest: file, append: true, sync: false }) },
  ]);
}

const transport = COMPILED ? null : pino.transport({
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
  transport ?? compiledDestinations(),
);

/** Returns a child logger tagged with a module name (shown in terminal). */
export function childLogger(module: string): pino.Logger {
  return logger.child({ module: `[${module}]` });
}
