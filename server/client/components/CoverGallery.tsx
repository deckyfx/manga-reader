import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pin, PinOff, Trash2, Upload } from "lucide-react";
import { addSeriesCover, coverArtUrl, listSeriesCovers, pinSeriesCover, removeSeriesCover, unpinSeriesCover } from "../api";
import { useConfirm } from "./ConfirmDialog";
import { ListError } from "./ListError";
import { onDay } from "../lib/format";

/**
 * The cover art of a series. Several are allowed: the newest is shown unless one is pinned, so adding a cover for a
 * new volume needs no further click, and going back to an older one is a pin away.
 */
export function CoverGallery({ seriesId }: { seriesId: number }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  // Part of Manage: asked as the library, so an adult series' covers show for a contributor who doesn't read them
  const coversQ = useQuery({ queryKey: ["covers", seriesId], queryFn: () => listSeriesCovers(seriesId, true) });

  // Both queries: the series card and the reader show whichever cover is current
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["covers", seriesId] });
    void qc.invalidateQueries({ queryKey: ["series"] });
  };

  const addM = useMutation({ mutationFn: (file: File) => addSeriesCover(seriesId, file), onSuccess: refresh });
  const pinM = useMutation({ mutationFn: (coverId: number) => pinSeriesCover(seriesId, coverId), onSuccess: refresh });
  const unpinM = useMutation({ mutationFn: () => unpinSeriesCover(seriesId), onSuccess: refresh });
  const removeM = useMutation({ mutationFn: (coverId: number) => removeSeriesCover(seriesId, coverId), onSuccess: refresh });

  const remove = async (coverId: number) => {
    const ok = await confirm({
      title: "Remove this cover?",
      message: "The image is deleted. The series falls back to its newest remaining cover, or to its first page.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) removeM.mutate(coverId);
  };

  const covers = coversQ.data ?? [];
  const busy = addM.isPending || pinM.isPending || unpinM.isPending || removeM.isPending;
  const error = addM.error ?? pinM.error ?? unpinM.error ?? removeM.error;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-200">Cover art</h2>
        <span className="text-xs text-gray-500">The newest shows, unless one is pinned.</span>
        {busy && <Loader2 size={13} className="animate-spin text-gray-500" />}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addM.mutate(file);
            e.target.value = "";
          }}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={addM.isPending}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          <Upload size={12} /> Add cover
        </button>
      </div>

      {coversQ.isError ? (
        <ListError error={coversQ.error} onRetry={() => void coversQ.refetch()} />
      ) : coversQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : covers.length === 0 ? (
        <p className="text-sm text-gray-500">No cover art yet — the first page of the first chapter stands in for it.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {covers.map((cover) => (
            <li key={cover.id} className="w-32 space-y-1.5">
              <div
                className={`relative flex aspect-2/3 items-center justify-center overflow-hidden rounded-lg border bg-gray-950 ${
                  cover.current ? "border-indigo-500" : "border-gray-800"
                }`}
              >
                <img src={coverArtUrl(seriesId, cover.id, true)} alt={cover.label ?? ""} className="h-full w-full object-cover" />
                {cover.current && (
                  <span className="absolute top-1 left-1 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[10px] text-white">
                    {cover.pinned ? "pinned" : "showing"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="truncate text-[11px] text-gray-500" title={cover.label ?? undefined}>
                  {cover.label ?? onDay(cover.created_at)}
                </span>
                <button
                  onClick={() => (cover.pinned ? unpinM.mutate() : pinM.mutate(cover.id))}
                  disabled={busy}
                  title={cover.pinned ? "Stop pinning, and show the newest" : "Always show this one"}
                  aria-label={cover.pinned ? "Unpin this cover" : "Pin this cover"}
                  className="ml-auto rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-50 disabled:opacity-40"
                >
                  {cover.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
                <button
                  onClick={() => void remove(cover.id)}
                  disabled={busy}
                  aria-label="Remove this cover"
                  className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </section>
  );
}
