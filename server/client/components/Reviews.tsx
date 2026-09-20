import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Star, Trash2 } from "lucide-react";
import { listChapterReviews, listSeriesReviews, putReview, removeReview, type Review } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { useConfirm } from "./ConfirmDialog";
import { ListError } from "./ListError";
import { when } from "../lib/format";

const STARS = [1, 2, 3, 4, 5];

/** A row of stars: filled up to `value`. Interactive when `onPick` is given. */
export function Stars({ value, size = 14, onPick }: { value: number; size?: number; onPick?: (rating: number) => void }) {
  return (
    <span className="flex items-center gap-0.5">
      {STARS.map((star) => {
        const filled = star <= Math.round(value);
        const icon = <Star size={size} className={filled ? "fill-amber-400 text-amber-400" : "text-gray-600"} />;
        return onPick ? (
          <button
            key={star}
            type="button"
            onClick={() => onPick(star)}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            className="rounded p-0.5 hover:bg-gray-800"
          >
            {icon}
          </button>
        ) : (
          <span key={star}>{icon}</span>
        );
      })}
    </span>
  );
}

/** The average as a card shows it: stars, the number, and how many people gave one. */
export function RatingBadge({ rating }: { rating: { average: number | null; count: number } }) {
  if (rating.average === null) return <span className="text-xs text-gray-600">not rated</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400">
      <Stars value={rating.average} size={12} />
      <span className="text-gray-300">{rating.average.toFixed(1)}</span>
      <span>({rating.count})</span>
    </span>
  );
}

/**
 * What readers made of a series or a chapter: the average, everyone's reviews, and — for anyone signed in — their
 * own, which reviewing again rewrites rather than adding a second one.
 */
export function Reviews({ target, id }: { target: "series" | "chapter"; id: number }) {
  const { account } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);

  const key = ["reviews", target, id];
  const reviewsQ = useQuery({
    queryKey: key,
    queryFn: () => (target === "series" ? listSeriesReviews(id) : listChapterReviews(id)),
  });

  // The average shows on the library cards and the series header too
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["series"] });
  };

  const saveM = useMutation({
    mutationFn: () => putReview(target, id, { rating, body: body.trim() || null }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const removeM = useMutation({ mutationFn: (reviewId: number) => removeReview(target, id, reviewId), onSuccess: refresh });

  const page = reviewsQ.data;
  const mine = page?.reviews.find((review) => review.mine);
  const others = page?.reviews.filter((review) => !review.mine) ?? [];

  const startEditing = () => {
    setRating(mine?.rating ?? 0);
    setBody(mine?.body ?? "");
    setEditing(true);
  };

  const drop = async (review: Review) => {
    const ok = await confirm({
      title: review.mine ? "Remove your review?" : `Remove ${review.username}'s review?`,
      message: "It stops counting towards the average.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) removeM.mutate(review.id);
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-200">Reviews</h2>
        {page && <RatingBadge rating={page.rating} />}
        {(reviewsQ.isFetching || saveM.isPending || removeM.isPending) && <Loader2 size={13} className="animate-spin text-gray-500" />}
        {account && !editing && (
          <button
            onClick={startEditing}
            className="ml-auto rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
          >
            {mine ? "Change your review" : "Write a review"}
          </button>
        )}
        {!account && (
          <Link to="/login" className="ml-auto text-xs text-indigo-300 hover:text-indigo-200">Sign in to review</Link>
        )}
      </div>

      {editing && (
        <form
          className="space-y-2 rounded-lg border border-gray-800 bg-gray-950 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (rating > 0) saveM.mutate();
          }}
        >
          <div className="flex items-center gap-3">
            <Stars value={rating} size={18} onPick={setRating} />
            <span className="text-xs text-gray-500">{rating > 0 ? `${rating} of 5` : "Pick a rating"}</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What did you make of it? (optional)"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={rating === 0 || saveM.isPending}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {mine ? "Save" : "Post"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800">
              Cancel
            </button>
            {saveM.error && <span className="text-xs text-red-400">{saveM.error.message}</span>}
          </div>
        </form>
      )}

      {reviewsQ.isError ? (
        <ListError error={reviewsQ.error} onRetry={() => void reviewsQ.refetch()} />
      ) : reviewsQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : (mine ? [mine, ...others] : others).length === 0 ? (
        <p className="text-sm text-gray-500">Nobody has reviewed this yet.</p>
      ) : (
        <ul className="space-y-2">
          {(mine ? [mine, ...others] : others).map((review) => (
            <li key={review.id} className={`rounded-lg border p-3 ${review.mine ? "border-indigo-900/60 bg-indigo-950/10" : "border-gray-800 bg-gray-950"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-200">{review.display_name ?? review.username}</span>
                {review.mine && <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-[10px] text-indigo-200">yours</span>}
                <Stars value={review.rating} size={12} />
                <span className="ml-auto text-xs text-gray-500">{when(review.updated_at)}</span>
                {(review.mine || account?.role === "admin") && (
                  <button
                    onClick={() => void drop(review)}
                    disabled={removeM.isPending}
                    aria-label="Remove this review"
                    className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {review.body && <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-300">{review.body}</p>}
            </li>
          ))}
        </ul>
      )}
      {removeM.error && <p className="text-sm text-red-400">{removeM.error.message}</p>}
    </section>
  );
}
