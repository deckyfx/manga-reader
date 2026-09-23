/**
 * pino-roll ships no types. Only what we call is declared: the entry point pino builds a transport from, which
 * returns a writable destination.
 */
declare module "pino-roll" {
  import type { Writable } from "node:stream";
  /** Options are pino-roll's own (file, extension, dateFormat, frequency, size, limit, mkdir, symlink). */
  export default function pinoRoll(options: Record<string, unknown>): Promise<Writable>;
}
