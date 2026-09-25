/**
 * Upgrading somebody's database, rather than making a new one.
 *
 * Every other test starts from a database built by running every migration at once, which is the one case that
 * cannot go wrong. What can go wrong is the upgrade: SQLite has no ALTER for most changes, so Drizzle rebuilds a
 * table by creating a new one, copying the rows across, dropping the old one and renaming — and `DROP TABLE` with
 * foreign keys enforced fires ON DELETE CASCADE on every child of the table being dropped. The children are gone,
 * the migration reports success, and nobody finds out until a reader opens a chapter that has no pages.
 *
 * That is why MigrationManager turns foreign keys off around the whole run (see applyMigrations). The pragma
 * cannot be written inside a migration, because Drizzle runs each one in a transaction and SQLite ignores it
 * there — so these tests wrap each migration in a transaction too. Without that they would pass on the strength of
 * the `PRAGMA foreign_keys=OFF` written inside 0007, and prove nothing about the code that protects it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MigrationManager } from "@/db/migration-manager";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "src", "db", "migrations");
const scratch = mkdtempSync(join(tmpdir(), "manga-reader-upgrade-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The migrations on disk, in the order they are meant to be applied. */
function migrations(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
}

/**
 * Applies migrations the way Drizzle does: one transaction per file, which is what makes a `PRAGMA foreign_keys`
 * written inside a migration a no-op.
 */
function apply(db: Database, files: string[]): void {
  for (const file of files) {
    const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    db.exec("BEGIN");
    try {
      for (const statement of statements) db.exec(statement);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`${file}: ${(error as Error).message}`);
    }
  }
}

/** A database at the state some released version left it in, with a library already in it. */
function databaseAsOf(name: string, upTo: string, withPages = true): Database {
  const db = new Database(join(scratch, `${name}.db`));
  const upToIndex = migrations().indexOf(upTo);
  if (upToIndex < 0) throw new Error(`no migration called ${upTo}`);

  const applied = migrations().slice(0, upToIndex + 1);
  apply(db, applied);
  recordAsApplied(db, applied);

  db.exec("INSERT INTO volumes (title) VALUES ('Blame!')");
  db.exec("INSERT INTO chapters (volume_id, title) VALUES (1, 'Chapter 1')");
  db.exec("INSERT INTO chapters (volume_id, title) VALUES (1, 'Chapter 2')");
  // Pages hang off chapters, which hang off volumes: the table being dropped is two steps above them.
  if (withPages) {
    db.exec("INSERT INTO pages (id, image_hash, source, chapter_id, sort_order) VALUES ('p1', 'h1', 'upload', 1, 1)");
    db.exec("INSERT INTO pages (id, image_hash, source, chapter_id, sort_order) VALUES ('p2', 'h2', 'upload', 1, 2)");
  }
  return db;
}

/**
 * Writes the bookkeeping Drizzle keeps, so the database looks like one an older build left behind rather than one
 * somebody assembled by hand. Without it the migrator sees an empty journal and tries to create tables that are
 * already there — which is a fair description of what a half-made fixture would tell you.
 */
function recordAsApplied(db: Database, files: string[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  for (const file of files) {
    const hash = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, file), "utf8")).digest("hex");
    const when = journal.entries.find((entry) => `${entry.tag}.sql` === file)?.when ?? 0;
    db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(hash, when);
  }
}

/** The migrations after the one the database is already at. */
function rest(from: string): string[] {
  return migrations().slice(migrations().indexOf(from) + 1);
}

/** 0007 is the one that rebuilds `volumes` and `chapters`, so it is the upgrade worth pinning. */
const BEFORE_HIERARCHY = "0007_series_hierarchy.sql";
const AT = "0006_read_library.sql";

describe("upgrading a database that already holds a library", () => {
  test("the chapters survive the rebuild that drops the table they point at", () => {
    const db = databaseAsOf("upgrade", AT);
    expect(db.query("SELECT count(*) AS n FROM chapters").get()).toEqual({ n: 2 });

    // As MigrationManager does it: enforcement off around the whole run, on again afterwards.
    db.exec("PRAGMA foreign_keys = OFF");
    apply(db, rest(AT));
    db.exec("PRAGMA foreign_keys = ON");

    const chapters = db.query<{ title: string; series_id: number }, []>(
      "SELECT title, series_id FROM chapters ORDER BY title",
    ).all();
    expect(chapters.map((row) => row.title)).toEqual(["Chapter 1", "Chapter 2"]);

    // …and they were given the series that 0007 makes out of their old volume, not left pointing at nothing.
    const series = db.query<{ id: number; title: string }, []>("SELECT id, title FROM series").all();
    expect(series).toHaveLength(1);
    expect(series[0]!.title).toBe("Blame!");
    for (const chapter of chapters) expect(chapter.series_id).toBe(series[0]!.id);

    // And the pages under them, which the same cascade would have taken next.
    const pages = db.query<{ id: string; chapter_id: number }, []>(
      "SELECT id, chapter_id FROM pages ORDER BY id",
    ).all();
    expect(pages.map((page) => page.id)).toEqual(["p1", "p2"]);

    db.close();
  });

  /**
   * What the pragma is protecting against, with the damage depending on what is in the database — which is why it
   * cannot be left to chance. A library of chapters alone loses them without a word.
   */
  test("with foreign keys left on, a library of chapters is silently emptied", () => {
    const db = databaseAsOf("hazard-quiet", AT, false);
    expect(db.query("SELECT count(*) AS n FROM chapters").get()).toEqual({ n: 2 });

    db.exec("PRAGMA foreign_keys = ON");
    apply(db, [BEFORE_HIERARCHY]);   // no error of any kind

    // DROP TABLE volumes cascaded into the chapters that pointed at it.
    expect(db.query("SELECT count(*) AS n FROM chapters").get()).toEqual({ n: 0 });
    db.close();
  });

  /** With pages under those chapters, the same run fails at the commit instead — a different kind of bad day. */
  test("with foreign keys left on and pages in the library, the upgrade fails outright", () => {
    const db = databaseAsOf("hazard-loud", AT);
    db.exec("PRAGMA foreign_keys = ON");

    expect(() => apply(db, [BEFORE_HIERARCHY])).toThrow("FOREIGN KEY constraint failed");

    // Rolled back: the database is still at the old schema, so the server would try again next start.
    const series = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'series'").all();
    expect(series).toHaveLength(0);
    expect(db.query("SELECT count(*) AS n FROM chapters").get()).toEqual({ n: 2 });
    db.close();
  });

  /**
   * The same upgrade through the code that actually performs it, and specifically through `init()` — the path the
   * server takes at startup, which turns foreign keys *on* before migrating. That is the only path where
   * `applyMigrations` switching them off again is load-bearing: `runMigrations`, the CLI path, never turns them on,
   * and SQLite has them off by default, so a test through that door passes whether the protection is there or not.
   *
   * It also uses the *embedded* copy of the migrations — the one a compiled binary carries — so a build that
   * forgot to re-embed them is caught here too.
   */
  test("MigrationManager.init brings an old database forward without losing the library", async () => {
    const db = databaseAsOf("manager", AT);
    db.close();

    const was = Bun.env.DATABASE_URL;
    Bun.env.DATABASE_URL = join(scratch, "manager.db");
    try {
      await MigrationManager.init();
    } finally {
      Bun.env.DATABASE_URL = was;
    }

    const migrated = new Database(join(scratch, "manager.db"));
    expect(migrated.query("SELECT count(*) AS n FROM chapters").get()).toEqual({ n: 2 });
    expect(migrated.query("SELECT count(*) AS n FROM pages").get()).toEqual({ n: 2 });
    expect(migrated.query<{ title: string }, []>("SELECT title FROM series").all()).toEqual([{ title: "Blame!" }]);

    // Nothing left dangling: the check the manager itself makes after switching enforcement back on.
    expect(migrated.query("PRAGMA foreign_key_check").all()).toEqual([]);
    migrated.close();
  });

  test("a fresh database and an upgraded one end up with the same shape", () => {
    const upgraded = databaseAsOf("shape-upgraded", AT);
    upgraded.exec("PRAGMA foreign_keys = OFF");
    apply(upgraded, rest(AT));

    const fresh = new Database(join(scratch, "shape-fresh.db"));
    apply(fresh, migrations());

    const shapeOf = (db: Database): string[] =>
      db.query<{ name: string; sql: string }, []>(
        // Drizzle's own bookkeeping table is not part of the schema under comparison.
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
        "AND name <> '__drizzle_migrations' ORDER BY name",
      ).all().map((row) => `${row.name}: ${(row.sql ?? "").replace(/\s+/g, " ")}`);

    expect(shapeOf(upgraded)).toEqual(shapeOf(fresh));

    upgraded.close();
    fresh.close();
  });

  test("every migration applies to an empty database, in order, without a hand on the wheel", () => {
    const db = new Database(join(scratch, "fresh-run.db"));
    expect(() => apply(db, migrations())).not.toThrow();

    // The journal Drizzle keeps must agree with what is on disk, or an upgrade re-runs or skips something.
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(migrations());

    db.close();
  });
});
