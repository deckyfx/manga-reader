import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/index";
import { series, seriesCovers, type NewSeriesCover, type SeriesCover } from "@/db/schema";

/**
 * The cover art of a series. A series may hold several; which one is shown is decided here, in one place, so the
 * reader, the library grid and the manage page can never disagree about it.
 */
export class CoverStore {
  /** Every cover of a series, newest first. */
  static async list(seriesId: number): Promise<SeriesCover[]> {
    return db.select().from(seriesCovers).where(eq(seriesCovers.seriesId, seriesId)).orderBy(desc(seriesCovers.id));
  }

  static async find(seriesId: number, coverId: number): Promise<SeriesCover | undefined> {
    return db
      .select()
      .from(seriesCovers)
      .where(and(eq(seriesCovers.seriesId, seriesId), eq(seriesCovers.id, coverId)))
      .get();
  }

  static async add(cover: NewSeriesCover): Promise<SeriesCover> {
    const [row] = await db.insert(seriesCovers).values(cover).returning();
    return row;
  }

  /**
   * The cover to show: the pinned one, else the newest. A pin that points at nothing — the row was deleted straight
   * in the database, or by an older build — is ignored rather than leaving the series with no cover at all.
   */
  static async current(seriesId: number): Promise<SeriesCover | undefined> {
    const row = await db.select({ coverId: series.coverId }).from(series).where(eq(series.id, seriesId)).get();
    if (row?.coverId != null) {
      const pinned = await CoverStore.find(seriesId, row.coverId);
      if (pinned) return pinned;
    }
    return db.select().from(seriesCovers).where(eq(seriesCovers.seriesId, seriesId)).orderBy(desc(seriesCovers.id)).get();
  }

  /** Pins one of this series' covers, or clears the pin so the newest shows. False when it isn't this series'. */
  static async pin(seriesId: number, coverId: number | null): Promise<boolean> {
    if (coverId !== null && !(await CoverStore.find(seriesId, coverId))) return false;
    await db.update(series).set({ coverId }).where(eq(series.id, seriesId));
    return true;
  }

  /**
   * Removes a cover row and returns the file name to delete, or null when that cover isn't this series'. The pin is
   * cleared first when it pointed here, so the series falls back to its newest remaining cover rather than to none.
   */
  static async remove(seriesId: number, coverId: number): Promise<string | null> {
    const cover = await CoverStore.find(seriesId, coverId);
    if (!cover) return null;
    const pinned = await db.select({ coverId: series.coverId }).from(series).where(eq(series.id, seriesId)).get();
    if (pinned?.coverId === coverId) await db.update(series).set({ coverId: null }).where(eq(series.id, seriesId));
    await db.delete(seriesCovers).where(and(eq(seriesCovers.seriesId, seriesId), eq(seriesCovers.id, coverId)));
    return cover.path;
  }

  /** File names of every cover of a series, for deleting them when the series goes. */
  static async paths(seriesId: number): Promise<string[]> {
    const rows = await db.select({ path: seriesCovers.path }).from(seriesCovers).where(eq(seriesCovers.seriesId, seriesId));
    return rows.map((row) => row.path);
  }
}
