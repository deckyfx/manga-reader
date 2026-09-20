import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { regionScans, type NewRegionScan, type RegionScan } from "@/db/schema";

export interface ScanQuery {
  /** Only this account's scans. Anyone who isn't an admin is pinned to their own id. */
  userId?: number;
  /** Matches the source or the translation. */
  search?: string;
  /**
   * Carry on below this row id. Ids rise with time, so this pages the same order the list shows, and a scan
   * arriving mid-read can't shuffle a row onto a page somebody has already been given.
   */
  beforeId?: number;
  limit?: number;
}

const MAX_LIMIT = 200;

/** `%` and `_` are wildcards in LIKE: somebody searching for "100%" means the text, not "anything after 100". */
const likePattern = (term: string): string => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export class ScanStore {
  /** One scan, as it happened. Failures are the caller's to swallow: a log must never break the scan it records. */
  static async insert(scan: NewRegionScan): Promise<RegionScan> {
    const [row] = await db.insert(regionScans).values(scan).returning();
    return row;
  }

  /**
   * Newest first, one page at a time. Paging is by (created_at, id) rather than an offset, so rows arriving while
   * somebody reads the list can't push a row onto a page they've already seen.
   */
  static async list(query: ScanQuery = {}): Promise<RegionScan[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT);
    const filters = [
      query.userId !== undefined ? eq(regionScans.userId, query.userId) : undefined,
      query.search
        ? or(
          sql`${regionScans.sourceText} LIKE ${likePattern(query.search)} ESCAPE '\\'`,
          sql`${regionScans.translatedText} LIKE ${likePattern(query.search)} ESCAPE '\\'`,
        )
        : undefined,
      query.beforeId !== undefined ? lt(regionScans.id, query.beforeId) : undefined,
    ].filter((filter) => filter !== undefined);

    return db
      .select()
      .from(regionScans)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(regionScans.id))
      .limit(limit);
  }

  /** Drops scans older than `days`, and returns how many went. Zero days keeps them for ever. */
  static async purgeOlderThan(days: number): Promise<number> {
    if (days <= 0) return 0;
    const result = await db
      .delete(regionScans)
      .where(lt(regionScans.createdAt, sql`datetime('now', ${`-${days} days`})`))
      .returning({ id: regionScans.id });
    return result.length;
  }
}
