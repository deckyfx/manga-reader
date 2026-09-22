import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Loader2, Plus, Search } from "lucide-react";
import { copyPageIntoChapter, createChapter, createSeries, fileWorkspace, getSeries, listSeries, seriesCoverUrl } from "../api";
import { MAX_SERIES_TAGS, splitTags, tagProblem } from "../../src/shared/tags";
import { Modal } from "./Modal";

interface ChapterPickerProps {
  /** The draft being filed; leave out and give `workspaceId` to file a whole workspace. */
  pageId?: string;
  /** Files every page of this workspace instead of one draft, keeping the workspace's order. */
  workspaceId?: number;
  /** True when the page already belongs to a chapter: it can only be copied from there, never moved out. */
  filed?: boolean;
  /** Shown in the dialog so it's clear which page is being filed; also the first guess at a new chapter's title. */
  pageLabel?: string;
  /** Tags the source offered (a gallery's own), prefilled when a series is made here. */
  suggestedTags?: string[];
  /** Starts a series made here as adult, as the workspace it's filed from is. */
  adult?: boolean;
  onClose: () => void;
  /** `skipped` is filled when a whole workspace was filed: pages moved but not published, or left behind. */
  onFiled: (chapterId: number, skipped?: { pageId: string; reason: string }[]) => void;
}

const INPUT = "w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none";

/**
 * Files a Studio draft into a chapter: pick the series, then the chapter — or make either on the spot. The draft is
 * copied by default, so the Studio keeps the original to work from; unticking "keep the draft" moves the page itself.
 */
export function ChapterPicker({
  pageId,
  workspaceId,
  pageLabel,
  suggestedTags,
  adult = false,
  filed = false,
  onClose,
  onFiled,
}: ChapterPickerProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [keepDraft, setKeepDraft] = useState(true);
  // The new-series and new-chapter forms, null while closed
  const [newSeries, setNewSeries] = useState<{ title: string; tags: string; adult: boolean } | null>(null);
  const [newChapter, setNewChapter] = useState<{ number: string; title: string } | null>(null);

  const seriesQ = useQuery({ queryKey: ["series", { q: search.trim() || undefined }], queryFn: () => listSeries({ q: search.trim() || undefined }) });
  const detailQ = useQuery({ queryKey: ["series", seriesId], queryFn: () => getSeries(seriesId ?? 0), enabled: seriesId !== null });

  const fileM = useMutation({
    // Filing a workspace can leave pages behind, and the caller reports those; a single page has nothing to report
    mutationFn: async (chapterId: number) => {
      if (workspaceId === undefined) {
        await copyPageIntoChapter(chapterId, pageId ?? "", { keep_draft: filed || keepDraft });
        return undefined;
      }
      return (await fileWorkspace(workspaceId, chapterId)).skipped;
    },
    onSuccess: (skipped, chapterId) => {
      void qc.invalidateQueries({ queryKey: ["studio-pages"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      if (workspaceId !== undefined) {
        void qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
        void qc.invalidateQueries({ queryKey: ["workspaces"] });
      }
      void qc.invalidateQueries({ queryKey: ["chapter", chapterId] });
      void qc.invalidateQueries({ queryKey: ["series"], refetchType: "none" });
      onFiled(chapterId, skipped);
    },
  });

  const seriesM = useMutation({
    mutationFn: (form: { title: string; tags: string; adult: boolean }) =>
      createSeries({ title: form.title.trim(), adult: form.adult, tags: splitTags(form.tags) }),
    onSuccess: (series) => {
      qc.setQueryData(["series", series.series.id], series);
      void qc.invalidateQueries({ queryKey: ["series"], refetchType: "none" });
      setNewSeries(null);
      setSeriesId(series.series.id);
      // A brand-new series has no chapters: go straight to making the first
      setNewChapter({ number: "1", title: pageLabel ?? "" });
    },
  });

  const chapterM = useMutation({
    mutationFn: async (form: { number: string; title: string }) => {
      const { chapter_id: chapterId, ...detail } = await createChapter({
        series_id: seriesId ?? 0,
        title: form.title.trim(),
        number: form.number.trim() || null,
      });
      qc.setQueryData(["series", detail.series.id], detail);
      return chapterId;
    },
    onSuccess: (chapterId) => {
      setNewChapter(null);
      fileM.mutate(chapterId);
    },
  });

  const chapters = detailQ.data ? [...detailQ.data.volumes.flatMap((volume) => volume.chapters), ...detailQ.data.unsorted] : [];
  const busy = fileM.isPending || seriesM.isPending || chapterM.isPending;
  // The server's own tag limits, checked as the field is typed in so the form says what's wrong before sending
  const seriesTagProblem = newSeries ? tagProblem(splitTags(newSeries.tags)) : null;
  const error = fileM.error ?? seriesM.error ?? chapterM.error;

  return (
    <Modal
      title={pageLabel ? `File “${pageLabel}” into a chapter` : "File into a chapter"}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          {error && <span className="mr-auto self-center text-xs text-red-400">{error.message}</span>}
          {workspaceId !== undefined ? (
            <span className="mr-auto self-center text-xs text-gray-500">
              The pages move into the chapter in this order, and the translated ones are published.
            </span>
          ) : filed ? (
            <span className="mr-auto self-center text-xs text-gray-500">The chapter gets its own copy; this page stays where it is.</span>
          ) : (
            <label className="mr-auto flex items-center gap-2 self-center text-xs text-gray-400" title="Off moves the page instead of copying it">
              <input type="checkbox" checked={keepDraft} onChange={(e) => setKeepDraft(e.target.checked)} className="accent-indigo-500" />
              Keep the draft in the Inbox
            </label>
          )}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800">Cancel</button>
        </>
      }
    >
      {seriesId === null ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5">
              <Search size={14} className="text-gray-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search series"
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </label>
            <button
              onClick={() => setNewSeries({ title: search.trim() || pageLabel || "", tags: (suggestedTags ?? []).slice(0, MAX_SERIES_TAGS).join(", "), adult })}
              disabled={newSeries !== null}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
            >
              <Plus size={14} /> New series
            </button>
          </div>

          {newSeries && (
            <form
              className="space-y-2 rounded-lg border border-indigo-900/60 bg-gray-950 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (newSeries.title.trim() && !seriesTagProblem) seriesM.mutate(newSeries);
              }}
            >
              <input
                value={newSeries.title}
                onChange={(e) => setNewSeries({ ...newSeries, title: e.target.value })}
                placeholder="Series title"
                maxLength={200}
                autoFocus
                className={INPUT}
              />
              <input
                value={newSeries.tags}
                onChange={(e) => setNewSeries({ ...newSeries, tags: e.target.value })}
                placeholder="Tags, separated by commas"
                className={INPUT}
              />
              {seriesTagProblem && <p className="text-xs text-red-400">{seriesTagProblem}</p>}
              {(suggestedTags?.length ?? 0) > 0 && (
                <p className="text-xs text-gray-500">The tags came from the page this workspace was imported from; edit them as you like.</p>
              )}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={newSeries.adult}
                    onChange={(e) => setNewSeries({ ...newSeries, adult: e.target.checked })}
                    className="accent-indigo-500"
                  />
                  Adult
                </label>
                <button type="button" onClick={() => setNewSeries(null)} className="ml-auto rounded-lg px-3 py-1 text-sm text-gray-400 hover:bg-gray-800">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newSeries.title.trim() || seriesTagProblem !== null || busy}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
                >
                  {seriesM.isPending && <Loader2 size={13} className="animate-spin" />} Create series
                </button>
              </div>
            </form>
          )}

          {seriesQ.isLoading ? (
            <Loader2 size={16} className="animate-spin text-gray-500" />
          ) : seriesQ.isError ? (
            <p className="text-sm text-red-400">The library couldn't be read: {seriesQ.error.message}</p>
          ) : (seriesQ.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-500">{search.trim() ? "No series matches." : "No series yet — make one with “New series”."}</p>
          ) : (
            <ul className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3 overflow-y-auto pr-1">
              {seriesQ.data?.map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => setSeriesId(entry.id)}
                    title={entry.title}
                    className="group flex w-full flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-950 text-left transition-colors hover:border-indigo-500"
                  >
                    <div className="flex aspect-[2/3] w-full items-center justify-center bg-gray-900">
                      {entry.has_cover ? (
                        <img src={seriesCoverUrl(entry.id, entry.updated_at)} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <BookOpen size={24} className="text-gray-700" />
                      )}
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="line-clamp-2 text-sm leading-snug">{entry.title}</p>
                      <p className="text-xs text-gray-500">
                        {entry.chapters} ch{entry.adult && <span className="ml-1.5 text-rose-400">adult</span>}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => {
              setSeriesId(null);
              setNewChapter(null);
            }}
            className="flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
          >
            <ArrowLeft size={12} /> Another series
          </button>
          {detailQ.isLoading ? (
            <Loader2 size={16} className="animate-spin text-gray-500" />
          ) : detailQ.isError ? (
            <p className="text-sm text-red-400">This series couldn't be read: {detailQ.error.message}</p>
          ) : detailQ.data ? (
            <div className="flex gap-4">
              <div className="hidden w-32 shrink-0 sm:block">
                <div className="flex aspect-[2/3] items-center justify-center overflow-hidden rounded-lg bg-gray-900">
                  {detailQ.data.series.has_cover ? (
                    <img src={seriesCoverUrl(detailQ.data.series.id, detailQ.data.series.updated_at)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <BookOpen size={24} className="text-gray-700" />
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <h3 className="line-clamp-2 font-semibold" title={detailQ.data.series.title}>{detailQ.data.series.title}</h3>
                  {detailQ.data.series.synopsis && <p className="mt-1 line-clamp-3 text-xs text-gray-400">{detailQ.data.series.synopsis}</p>}
                </div>

                {newChapter ? (
                  <form
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-900/60 bg-gray-950 p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newChapter.title.trim()) chapterM.mutate(newChapter);
                    }}
                  >
                    <input
                      value={newChapter.number}
                      onChange={(e) => setNewChapter({ ...newChapter, number: e.target.value })}
                      placeholder="No."
                      maxLength={20}
                      aria-label="Chapter number"
                      className={`${INPUT} w-20`}
                    />
                    <input
                      value={newChapter.title}
                      onChange={(e) => setNewChapter({ ...newChapter, title: e.target.value })}
                      placeholder="Chapter title"
                      maxLength={200}
                      autoFocus
                      aria-label="Chapter title"
                      className={`${INPUT} min-w-48 flex-1`}
                    />
                    <button type="button" onClick={() => setNewChapter(null)} className="rounded-lg px-3 py-1 text-sm text-gray-400 hover:bg-gray-800">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!newChapter.title.trim() || busy}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
                    >
                      {(chapterM.isPending || fileM.isPending) && <Loader2 size={13} className="animate-spin" />} Create and file here
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setNewChapter({ number: String(chapters.length + 1), title: pageLabel ?? "" })}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                  >
                    <Plus size={14} /> New chapter
                  </button>
                )}

                {chapters.length === 0 ? (
                  <p className="text-sm text-gray-500">This series has no chapters yet — make the first above.</p>
                ) : (
                  <ul className="max-h-[50vh] divide-y divide-gray-800 overflow-y-auto rounded-lg border border-gray-800">
                    {chapters.map((chapter) => (
                      <li key={chapter.id}>
                        <button
                          onClick={() => fileM.mutate(chapter.id)}
                          disabled={busy}
                          title={chapter.title}
                          className="flex w-full items-center gap-2 bg-gray-950 px-3 py-2 text-left hover:bg-gray-900 disabled:opacity-50"
                        >
                          <span className="truncate text-sm">
                            {chapter.number ? `${chapter.number}. ` : ""}
                            {chapter.title}
                          </span>
                          <span className="ml-auto shrink-0 text-xs text-gray-500">{chapter.pages} pg</span>
                          {fileM.isPending && fileM.variables === chapter.id && <Loader2 size={13} className="animate-spin text-gray-400" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
