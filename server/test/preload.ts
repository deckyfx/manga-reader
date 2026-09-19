/**
 * Runs before every test file: points the server at a throwaway data folder and builds its database.
 *
 * Everything the server writes — the database, page folders, covers, logs, the secret key — lives under DATA_DIR, so
 * a test run can never touch the real `data/` next to it. The folder is removed when the run ends.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "web-ocr-test-"));
Bun.env.DATA_DIR = dataDir;
Bun.env.DATABASE_URL = join(dataDir, "ocr.db");
Bun.env.NODE_ENV = "test";

const { MigrationManager } = await import("@/db/migration-manager");
await MigrationManager.runMigrations();

// A hook registered here applies to the whole run; process "exit" handlers don't fire under bun test
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
