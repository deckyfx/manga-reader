import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { reviews, users, type Review, type ReviewTarget } from "@/db/schema";

/** A rating as a series or chapter card shows it. */
export interface RatingSummary {
  /** Mean rating to one decimal place, or null when nobody has rated it. */
  average: number | null;
  count: number;
}

export const NO_RATING: RatingSummary = { average: null, count: 0 };

/** A review with the name to show beside it. */
export interface ReviewWithAuthor {
  review: Review;
  username: string;
  displayName: string | null;
}

export class ReviewStore {
  /** Reviews of one thing, newest first, with their authors. */
  static async list(target: ReviewTarget, targetId: number): Promise<ReviewWithAuthor[]> {
    const rows = await db
      .select({ review: reviews, username: users.username, displayName: users.displayName })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(and(eq(reviews.target, target), eq(reviews.targetId, targetId)))
      .orderBy(desc(reviews.id));
    return rows.map((row) => ({ review: row.review, username: row.username, displayName: row.displayName }));
  }

  static async mine(target: ReviewTarget, targetId: number, userId: number): Promise<Review | undefined> {
    return db
      .select()
      .from(reviews)
      .where(and(eq(reviews.target, target), eq(reviews.targetId, targetId), eq(reviews.userId, userId)))
      .get();
  }

  /**
   * Writes somebody's review of a thing. One per account per thing: reviewing again rewrites what they said rather
   * than adding a second opinion, which is what the unique index enforces underneath.
   */
  static async put(entry: { target: ReviewTarget; targetId: number; userId: number; rating: number; body: string | null }): Promise<Review> {
    const [row] = await db
      .insert(reviews)
      .values(entry)
      .onConflictDoUpdate({
        target: [reviews.target, reviews.targetId, reviews.userId],
        set: { rating: entry.rating, body: entry.body, updatedAt: sql`(datetime('now'))` },
      })
      .returning();
    return row;
  }

  /** Removes one review. Anyone may remove their own; an admin may remove anyone's, which is what `userId` omits. */
  static async remove(id: number, userId?: number): Promise<boolean> {
    const filters = [eq(reviews.id, id)];
    if (userId !== undefined) filters.push(eq(reviews.userId, userId));
    const removed = await db.delete(reviews).where(and(...filters)).returning({ id: reviews.id });
    return removed.length > 0;
  }

  /** Reviews of a thing that has been deleted; there is no foreign key to do it for us. */
  static async forgetTarget(target: ReviewTarget, targetId: number): Promise<void> {
    await db.delete(reviews).where(and(eq(reviews.target, target), eq(reviews.targetId, targetId)));
  }

  static async summary(target: ReviewTarget, targetId: number): Promise<RatingSummary> {
    return (await ReviewStore.summaries(target, [targetId])).get(targetId) ?? NO_RATING;
  }

  /** Ratings of many things at once, for lists that would otherwise ask one query per card. */
  static async summaries(target: ReviewTarget, targetIds: number[]): Promise<Map<number, RatingSummary>> {
    if (targetIds.length === 0) return new Map();
    const rows = await db
      .select({ targetId: reviews.targetId, average: sql<number>`avg(${reviews.rating})`, count: sql<number>`count(*)` })
      .from(reviews)
      .where(and(eq(reviews.target, target), inArray(reviews.targetId, targetIds)))
      .groupBy(reviews.targetId);
    return new Map(rows.map((row) => [
      row.targetId,
      { average: Math.round(Number(row.average) * 10) / 10, count: Number(row.count) },
    ]));
  }
}
