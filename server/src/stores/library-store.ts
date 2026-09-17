/**
 * The library: series → volume (optional) → chapter → page. Series carry the metadata the reader shows and the tags it
 * searches by; volumes group chapters, and a chapter may sit directly under its series.
 */
import { and, asc, desc, eq, inArray, isNull, like, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { chapters, pages, series, seriesTags, volumes, type Chapter, type NewChapter, type NewSeries, type NewVolume, type Series, type Volume } from "@/db/schema";

export const SERIES_STATUSES = ["ongoing", "completed", "hiatus"] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

/** What the library list can be narrowed by. */
export interface SeriesFilter {
  /** Matches the title, case-insensitively. */
  search?: string;
  /** Series must carry every one of these tags. */
  withTags?: string[];
  /** Series carrying any of these tags are left out. */
  withoutTags?: string[];
  /** Only series that already have chapters. */
  hasChapters?: boolean;
  status?: SeriesStatus;
  sort?: "title" | "recent";
}

/** A series with everything the library card shows. */
export interface SeriesWithCounts {
  series: Series;
  tags: string[];
  chapters: number;
  volumes: number;
  /** First page of its first chapter, for the cover fallback. */
  firstPageId: string | null;
}

/** Tags normalised the way they're stored and compared: trimmed, lower case, no empties or duplicates. */
export function normaliseTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase().slice(0, 40);
    if (clean) seen.add(clean);
  }
  return [...seen].sort();
}

export class SeriesStore {
  static async findById(id: number): Promise<Series | undefined> {
    return db.query.series.findFirst({ where: eq(series.id, id) });
  }

  /** Tags of each of these series. */
  static async tagsFor(seriesIds: number[]): Promise<Map<number, string[]>> {
    if (seriesIds.length === 0) return new Map();
    const rows = await db.select().from(seriesTags).where(inArray(seriesTags.seriesId, seriesIds)).orderBy(asc(seriesTags.tag));
    const byId = new Map<number, string[]>();
    for (const row of rows) byId.set(row.seriesId, [...(byId.get(row.seriesId) ?? []), row.tag]);
    return byId;
  }

  /** Every tag in use, with how many series carry it (for the search panel). */
  static async allTags(): Promise<{ tag: string; count: number }[]> {
    const rows = await db
      .select({ tag: seriesTags.tag, count: sql<number>`count(*)` })
      .from(seriesTags)
      .groupBy(seriesTags.tag)
      .orderBy(asc(seriesTags.tag));
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }

  /** The library, filtered and sorted, with the counts and cover fallback each card needs. */
  static async list(filter: SeriesFilter = {}): Promise<SeriesWithCounts[]> {
    const conditions = [];
    if (filter.search?.trim()) conditions.push(like(series.title, `%${filter.search.trim()}%`));
    if (filter.status) conditions.push(eq(series.status, filter.status));

    const required = normaliseTags(filter.withTags ?? []);
    if (required.length > 0) {
      // Every required tag must be present, so count the matches per series
      const matching = db
        .select({ id: seriesTags.seriesId })
        .from(seriesTags)
        .where(inArray(seriesTags.tag, required))
        .groupBy(seriesTags.seriesId)
        .having(sql`count(distinct ${seriesTags.tag}) = ${required.length}`);
      conditions.push(inArray(series.id, matching));
    }
    const excluded = normaliseTags(filter.withoutTags ?? []);
    if (excluded.length > 0) {
      conditions.push(notInArray(series.id, db.select({ id: seriesTags.seriesId }).from(seriesTags).where(inArray(seriesTags.tag, excluded))));
    }

    const rows = await db
      .select()
      .from(series)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(filter.sort === "recent" ? desc(series.updatedAt) : asc(series.title));

    const ids = rows.map((row) => row.id);
    const [tags, chapterCounts, volumeCounts, covers] = await Promise.all([
      SeriesStore.tagsFor(ids),
      SeriesStore.countChapters(ids),
      SeriesStore.countVolumes(ids),
      SeriesStore.coverPages(ids),
    ]);

    const list = rows.map((row) => ({
      series: row,
      tags: tags.get(row.id) ?? [],
      chapters: chapterCounts.get(row.id) ?? 0,
      volumes: volumeCounts.get(row.id) ?? 0,
      firstPageId: covers.get(row.id) ?? null,
    }));
    return filter.hasChapters ? list.filter((entry) => entry.chapters > 0) : list;
  }

  private static async countChapters(ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ seriesId: chapters.seriesId, count: sql<number>`count(*)` })
      .from(chapters)
      .where(inArray(chapters.seriesId, ids))
      .groupBy(chapters.seriesId);
    return new Map(rows.map((row) => [row.seriesId, Number(row.count)]));
  }

  private static async countVolumes(ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ seriesId: volumes.seriesId, count: sql<number>`count(*)` })
      .from(volumes)
      .where(inArray(volumes.seriesId, ids))
      .groupBy(volumes.seriesId);
    return new Map(rows.map((row) => [row.seriesId, Number(row.count)]));
  }

  /** First page of each series' first chapter, used when no cover was uploaded. */
  private static async coverPages(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ seriesId: chapters.seriesId, pageId: pages.id, chapterOrder: chapters.sortOrder, pageOrder: pages.sortOrder })
      .from(chapters)
      .innerJoin(pages, eq(pages.chapterId, chapters.id))
      .where(inArray(chapters.seriesId, ids))
      .orderBy(asc(chapters.sortOrder), asc(chapters.id), asc(pages.sortOrder));
    const first = new Map<number, string>();
    for (const row of rows) if (!first.has(row.seriesId)) first.set(row.seriesId, row.pageId);
    return first;
  }

  /** One series with the same counts and cover fallback the list returns. */
  static async withCounts(id: number): Promise<SeriesWithCounts | null> {
    const row = await SeriesStore.findById(id);
    if (!row) return null;
    const [tags, chapterCounts, volumeCounts, covers] = await Promise.all([
      SeriesStore.tagsFor([id]),
      SeriesStore.countChapters([id]),
      SeriesStore.countVolumes([id]),
      SeriesStore.coverPages([id]),
    ]);
    return {
      series: row,
      tags: tags.get(id) ?? [],
      chapters: chapterCounts.get(id) ?? 0,
      volumes: volumeCounts.get(id) ?? 0,
      firstPageId: covers.get(id) ?? null,
    };
  }

  static async insert(data: NewSeries, tags: readonly string[] = []): Promise<Series> {
    const [row] = await db.insert(series).values(data).returning();
    if (!row) throw new Error("failed to create series");
    await SeriesStore.setTags(row.id, tags);
    return row;
  }

  /** Updates the series; `tags` (when given) replaces its whole tag set. */
  static async update(id: number, data: Partial<NewSeries>, tags?: readonly string[]): Promise<Series | undefined> {
    const [row] = await db
      .update(series)
      .set({ ...data, updatedAt: sql`(datetime('now'))` })
      .where(eq(series.id, id))
      .returning();
    if (!row) return undefined;
    if (tags) await SeriesStore.setTags(id, tags);
    return row;
  }

  static async setTags(id: number, tags: readonly string[]): Promise<void> {
    const wanted = normaliseTags(tags);
    db.transaction((tx) => {
      tx.delete(seriesTags).where(eq(seriesTags.seriesId, id)).run();
      if (wanted.length > 0) tx.insert(seriesTags).values(wanted.map((tag) => ({ seriesId: id, tag }))).run();
    });
  }

  /** Deletes a series with its volumes and chapters; the pages keep their images and return to the Inbox. */
  static async delete(id: number): Promise<void> {
    db.transaction((tx) => {
      const owned = tx.select({ id: chapters.id }).from(chapters).where(eq(chapters.seriesId, id)).all();
      if (owned.length > 0) {
        tx.update(pages)
          .set({ chapterId: null, sortOrder: 0, updatedAt: sql`(datetime('now'))` })
          .where(inArray(pages.chapterId, owned.map((chapter) => chapter.id)))
          .run();
      }
      tx.delete(chapters).where(eq(chapters.seriesId, id)).run();
      tx.delete(volumes).where(eq(volumes.seriesId, id)).run();
      tx.delete(seriesTags).where(eq(seriesTags.seriesId, id)).run();
      tx.delete(series).where(eq(series.id, id)).run();
    });
  }
}

export class VolumeStore {
  static async listBySeries(seriesId: number): Promise<Volume[]> {
    return db.select().from(volumes).where(eq(volumes.seriesId, seriesId)).orderBy(asc(volumes.sortOrder), asc(volumes.id));
  }

  static async findById(id: number): Promise<Volume | undefined> {
    return db.query.volumes.findFirst({ where: eq(volumes.id, id) });
  }

  static async insert(data: NewVolume): Promise<Volume> {
    const [row] = await db.insert(volumes).values(data).returning();
    if (!row) throw new Error("failed to create volume");
    return row;
  }

  static async update(id: number, data: Partial<NewVolume>): Promise<Volume | undefined> {
    const [row] = await db
      .update(volumes)
      .set({ ...data, updatedAt: sql`(datetime('now'))` })
      .where(eq(volumes.id, id))
      .returning();
    return row;
  }

  /** Deletes a volume; its chapters stay in the series as unsorted chapters. */
  static async delete(id: number): Promise<void> {
    db.transaction((tx) => {
      tx.update(chapters)
        .set({ volumeId: null, updatedAt: sql`(datetime('now'))` })
        .where(eq(chapters.volumeId, id))
        .run();
      tx.delete(volumes).where(eq(volumes.id, id)).run();
    });
  }

  /** Next free position in a series, so a new volume goes last. */
  static async nextOrder(seriesId: number): Promise<number> {
    const row = await db
      .select({ max: sql<number>`coalesce(max(${volumes.sortOrder}), 0)` })
      .from(volumes)
      .where(eq(volumes.seriesId, seriesId))
      .get();
    return (row?.max ?? 0) + 1;
  }
}

export class ChapterStore {
  static async listBySeries(seriesId: number): Promise<Chapter[]> {
    return db.select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.sortOrder), asc(chapters.id));
  }

  /** Chapters of a series with no volume: shown as "unsorted" in the series. */
  static async listUnsorted(seriesId: number): Promise<Chapter[]> {
    return db
      .select()
      .from(chapters)
      .where(and(eq(chapters.seriesId, seriesId), isNull(chapters.volumeId)))
      .orderBy(asc(chapters.sortOrder), asc(chapters.id));
  }

  static async findById(id: number): Promise<Chapter | undefined> {
    return db.query.chapters.findFirst({ where: eq(chapters.id, id) });
  }

  static async insert(data: NewChapter): Promise<Chapter> {
    const [row] = await db.insert(chapters).values(data).returning();
    if (!row) throw new Error("failed to create chapter");
    return row;
  }

  static async update(id: number, data: Partial<NewChapter>): Promise<Chapter | undefined> {
    const [row] = await db
      .update(chapters)
      .set({ ...data, updatedAt: sql`(datetime('now'))` })
      .where(eq(chapters.id, id))
      .returning();
    return row;
  }

  /** Deletes a chapter; its pages keep their images and return to the Inbox. */
  static async delete(id: number): Promise<void> {
    db.transaction((tx) => {
      tx.update(pages)
        .set({ chapterId: null, sortOrder: 0, updatedAt: sql`(datetime('now'))` })
        .where(eq(pages.chapterId, id))
        .run();
      tx.delete(chapters).where(eq(chapters.id, id)).run();
    });
  }

  static async nextOrder(seriesId: number): Promise<number> {
    const row = await db
      .select({ max: sql<number>`coalesce(max(${chapters.sortOrder}), 0)` })
      .from(chapters)
      .where(eq(chapters.seriesId, seriesId))
      .get();
    return (row?.max ?? 0) + 1;
  }
}
