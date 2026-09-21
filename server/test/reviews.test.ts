/**
 * Reviews and ratings: one per account per thing, readable by anyone, writable by anyone signed in.
 *
 * The decisions being pinned down here (made unattended on 2026-09-20, in the absence of the user): any signed-in
 * account may review, may rewrite or remove its own, and an admin may remove anybody's. A tool's API key may not
 * review at all — a key exists to run OCR, not to have opinions.
 */
import { describe, expect, test } from "bun:test";
import { ReviewStore } from "@/stores/review-store";
import { call, signedIn } from "./harness";

interface ReviewPage {
  rating: { average: number | null; count: number };
  reviews: { id: number; username: string; rating: number; body: string | null; mine: boolean }[];
}

async function aSeries(cookie: string): Promise<number> {
  const made = await call<{ series: { id: number } }>("POST", "/manage/api/series", { title: `Reviews ${crypto.randomUUID()}` }, { cookie });
  return made.body.series.id;
}

async function aChapter(cookie: string, seriesId: number): Promise<number> {
  const made = await call<{ unsorted: { id: number }[] }>("POST", "/manage/api/chapters", { series_id: seriesId, title: "One" }, { cookie });
  return made.body.unsorted[0]!.id;
}

describe("writing a review", () => {
  test("a reader may review, and reviewing again rewrites rather than stacking up", async () => {
    const owner = await signedIn("contributor");
    const reader = await signedIn("reader");
    const id = await aSeries(owner.cookie);

    const first = await call<ReviewPage>("PUT", `/manage/api/reviews/series/${id}`, { rating: 4, body: "good" }, { cookie: reader.cookie });
    expect(first.status).toBe(200);
    expect(first.body.rating).toEqual({ average: 4, count: 1 });
    expect(first.body.reviews[0]).toMatchObject({ rating: 4, body: "good", mine: true });

    const second = await call<ReviewPage>("PUT", `/manage/api/reviews/series/${id}`, { rating: 2, body: "changed my mind" }, { cookie: reader.cookie });
    expect(second.body.reviews).toHaveLength(1);
    expect(second.body.rating).toEqual({ average: 2, count: 1 });
  });

  test("the average is of people, and comes back to one decimal place", async () => {
    const owner = await signedIn("contributor");
    const id = await aSeries(owner.cookie);
    for (const rating of [5, 4, 4]) {
      const voter = await signedIn("reader");
      await call("PUT", `/manage/api/reviews/series/${id}`, { rating }, { cookie: voter.cookie });
    }
    const page = await call<ReviewPage>("GET", `/read/api/series/${id}/reviews`);
    expect(page.body.rating).toEqual({ average: 4.3, count: 3 });
  });

  test("chapters are reviewed separately from their series", async () => {
    const owner = await signedIn("contributor");
    const reader = await signedIn("reader");
    const seriesId = await aSeries(owner.cookie);
    const chapterId = await aChapter(owner.cookie, seriesId);

    await call("PUT", `/manage/api/reviews/series/${seriesId}`, { rating: 5 }, { cookie: reader.cookie });
    await call("PUT", `/manage/api/reviews/chapter/${chapterId}`, { rating: 1 }, { cookie: reader.cookie });

    expect((await call<ReviewPage>("GET", `/read/api/series/${seriesId}/reviews`)).body.rating.average).toBe(5);
    expect((await call<ReviewPage>("GET", `/read/api/chapters/${chapterId}/reviews`)).body.rating.average).toBe(1);
  });

  test("a rating outside 1–5, or a review of something that isn't there, is refused", async () => {
    const reader = await signedIn("reader");
    const owner = await signedIn("contributor");
    const id = await aSeries(owner.cookie);

    expect((await call("PUT", `/manage/api/reviews/series/${id}`, { rating: 0 }, { cookie: reader.cookie })).status).toBe(422);
    expect((await call("PUT", `/manage/api/reviews/series/${id}`, { rating: 6 }, { cookie: reader.cookie })).status).toBe(422);
    expect((await call("PUT", `/manage/api/reviews/series/999999`, { rating: 3 }, { cookie: reader.cookie })).status).toBe(404);
    expect((await call("PUT", `/manage/api/reviews/chapter/999999`, { rating: 3 }, { cookie: reader.cookie })).status).toBe(404);
  });
});

describe("who may review, and who may remove one", () => {
  test("a guest may read reviews but not write one", async () => {
    const owner = await signedIn("contributor");
    const id = await aSeries(owner.cookie);
    expect((await call("GET", `/read/api/series/${id}/reviews`)).status).toBe(200);
    expect((await call("PUT", `/manage/api/reviews/series/${id}`, { rating: 3 })).status).toBe(401);
  });

  test("an API key may not review, however good its role", async () => {
    const owner = await signedIn("contributor");
    const id = await aSeries(owner.cookie);
    const key = await call<{ key: string }>("POST", "/auth/api/keys", { name: "tool" }, { cookie: owner.cookie });

    const refused = await call("PUT", `/manage/api/reviews/series/${id}`, { rating: 5 }, { key: key.body.key });
    expect(refused.status).toBe(403);
  });

  test("you may remove your own; somebody else's is not yours to remove", async () => {
    const owner = await signedIn("contributor");
    const mine = await signedIn("reader");
    const theirs = await signedIn("reader");
    const id = await aSeries(owner.cookie);

    const ours = await call<ReviewPage>("PUT", `/manage/api/reviews/series/${id}`, { rating: 5 }, { cookie: mine.cookie });
    await call("PUT", `/manage/api/reviews/series/${id}`, { rating: 1 }, { cookie: theirs.cookie });
    const myReviewId = ours.body.reviews[0].id;

    expect((await call("DELETE", `/manage/api/reviews/series/${id}/${myReviewId}`, undefined, { cookie: theirs.cookie })).status).toBe(404);
    const after = await call<ReviewPage>("DELETE", `/manage/api/reviews/series/${id}/${myReviewId}`, undefined, { cookie: mine.cookie });
    expect(after.body.reviews).toHaveLength(1);
    expect(after.body.rating).toEqual({ average: 1, count: 1 });
  });

  test("a delete is scoped to the thing in the URL, not just the review id", async () => {
    const owner = await signedIn("contributor");
    const reader = await signedIn("reader");
    const seriesId = await aSeries(owner.cookie);
    const chapterId = await aChapter(owner.cookie, seriesId);
    const onSeries = await call<ReviewPage>("PUT", `/manage/api/reviews/series/${seriesId}`, { rating: 5 }, { cookie: reader.cookie });
    const reviewId = onSeries.body.reviews[0].id;

    // The same id and the same caller, but a URL about something else: their own review must survive it
    expect((await call("DELETE", `/manage/api/reviews/chapter/${chapterId}/${reviewId}`, undefined, { cookie: reader.cookie })).status).toBe(404);
    expect((await call("DELETE", `/manage/api/reviews/series/${seriesId + 12345}/${reviewId}`, undefined, { cookie: reader.cookie })).status).toBe(404);
    expect(await ReviewStore.list("series", seriesId)).toHaveLength(1);
  });

  test("an admin may remove anybody's", async () => {
    const admin = await signedIn("admin");
    const reader = await signedIn("reader");
    const id = await aSeries(admin.cookie);
    const posted = await call<ReviewPage>("PUT", `/manage/api/reviews/series/${id}`, { rating: 2 }, { cookie: reader.cookie });

    const after = await call<ReviewPage>("DELETE", `/manage/api/reviews/series/${id}/${posted.body.reviews[0].id}`, undefined, { cookie: admin.cookie });
    expect(after.status).toBe(200);
    expect(after.body.reviews).toEqual([]);
  });
});

describe("what happens to reviews when their subject goes", () => {
  test("deleting a series takes its reviews, and its chapters', with it", async () => {
    const owner = await signedIn("contributor");
    const reader = await signedIn("reader");
    const seriesId = await aSeries(owner.cookie);
    const chapterId = await aChapter(owner.cookie, seriesId);
    await call("PUT", `/manage/api/reviews/series/${seriesId}`, { rating: 5 }, { cookie: reader.cookie });
    await call("PUT", `/manage/api/reviews/chapter/${chapterId}`, { rating: 4 }, { cookie: reader.cookie });

    expect((await call("DELETE", `/manage/api/series/${seriesId}`, undefined, { cookie: owner.cookie })).status).toBe(200);
    expect(await ReviewStore.list("series", seriesId)).toEqual([]);
    expect(await ReviewStore.list("chapter", chapterId)).toEqual([]);
  });

  test("deleting a chapter takes only its own", async () => {
    const owner = await signedIn("contributor");
    const reader = await signedIn("reader");
    const seriesId = await aSeries(owner.cookie);
    const chapterId = await aChapter(owner.cookie, seriesId);
    await call("PUT", `/manage/api/reviews/series/${seriesId}`, { rating: 5 }, { cookie: reader.cookie });
    await call("PUT", `/manage/api/reviews/chapter/${chapterId}`, { rating: 4 }, { cookie: reader.cookie });

    expect((await call("DELETE", `/manage/api/chapters/${chapterId}`, undefined, { cookie: owner.cookie })).status).toBe(200);
    expect(await ReviewStore.list("chapter", chapterId)).toEqual([]);
    expect(await ReviewStore.list("series", seriesId)).toHaveLength(1);
  });

  test("deleting an account takes its reviews with it", async () => {
    const admin = await signedIn("admin");
    const reader = await signedIn("reader");
    const id = await aSeries(admin.cookie);
    await call("PUT", `/manage/api/reviews/series/${id}`, { rating: 3 }, { cookie: reader.cookie });

    expect((await call("DELETE", `/manage/api/users/${reader.id}`, undefined, { cookie: admin.cookie })).status).toBe(200);
    // The row cascades away with the account, so the average is of people who still exist
    expect((await call<ReviewPage>("GET", `/read/api/series/${id}/reviews`)).body.rating).toEqual({ average: null, count: 0 });
  });
});

describe("the rating on a series", () => {
  test("shows on the series itself, and starts as nothing", async () => {
    const owner = await signedIn("contributor");
    const reader = await signedIn("reader");
    const id = await aSeries(owner.cookie);

    const before = await call<{ series: { rating: { average: number | null; count: number } } }>("GET", `/read/api/series/${id}`);
    expect(before.body.series.rating).toEqual({ average: null, count: 0 });

    await call("PUT", `/manage/api/reviews/series/${id}`, { rating: 4 }, { cookie: reader.cookie });
    const after = await call<{ series: { rating: { average: number | null; count: number } } }>("GET", `/read/api/series/${id}`);
    expect(after.body.series.rating).toEqual({ average: 4, count: 1 });
  });
});
