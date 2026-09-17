/**
 * Structured logger built on pino.
 *
 * Outputs:
 *  - Colourful, human-readable lines to stdout (pino-pretty).
 *  - Structured JSON to ./logs/server-YYYY-MM-DD.log with daily rotation
 *    and 10 MB size cap (pino-roll).
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Server started");
 *   logger.error({ err }, "Something failed");
 *   logger.child({ module: "ocr" }).info("Model loaded");
 */

import pino from "pino";
import { mkdirSync } from "node:fs";

const LOG_DIR = "./data/logs";
mkdirSync(LOG_DIR, { recursive: true });

const isDev = (Bun.env.NODE_ENV ?? "development") !== "production";

const transport = pino.transport({
  targets: [
    // ── Colourful terminal ──────────────────────────────────────────────────
    {
      target: "pino-pretty",
      level: isDev ? "debug" : "info",
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
      options: {
        file: `${LOG_DIR}/server.log`,
        // Rotated files land alongside: server.log.2026-09-13, etc.
        // Roll daily; also roll when file exceeds 10 MB.
        frequency: "daily",
        size: "10m",
        // Keep 14 days of rotated logs.
        limit: { count: 14 },
        mkdir: true,
        extension: ".json",
      },
    },
  ],
});

export const logger = pino(
  {
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
