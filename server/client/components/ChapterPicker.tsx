import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2, Search } from "lucide-react";
import { copyPageIntoChapter, getSeries, listSeries } from "../api";
import { Modal } from "./Modal";

interface ChapterPickerProps {
  pageId: string;
  /** Shown in the dialog so it's clear which page is being filed. */
  pageLabel?: string;
  onClose: () => void;
  onFiled: (chapterId: number) => void;
}

/**
 * Files a Studio draft into a chapter: pick the series, then the chapter. The draft is copied by default, so the
 * Studio keeps the original to work from; unticking "keep the draft" moves the page itself.
 */
export function ChapterPicker({ pageId, pageLabel, onClose, onFiled }: ChapterPickerProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [keepDraft, setKeepDraft] = useState(true);

  const seriesQ = useQuery({ queryKey: ["series", { q: search.trim() || undefined }], queryFn: () => listSeries({ q: search.trim() || undefined }) });
  const detailQ = useQuery({ queryKey: ["series", seriesId], queryFn: () => getSeries(seriesId ?? 0), enabled: seriesId !== null });

  const fileM = useMutation({
    mutationFn: (chapterId: number) => copyPageIntoChapter(chapterId, pageId, { keep_draft: keepDraft }),
    onSuccess: (_detail, chapterId) => {
      void qc.invalidateQueries({ queryKey: ["studio-pages"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["chapter", chapterId] });
      void qc.invalidateQueries({ queryKey: ["series"], refetchType: "none" });
      onFiled(chapterId);
    },
  });

  const chapters = detailQ.data ? [...detailQ.data.volumes.flatMap((volume) => volume.chapters), ...detailQ.data.unsorted] : [];

  return (
    <Modal
      title={pageLabel ? `File “${pageLabel}” into a chapter` : "File into a chapter"}
      onClose={onClose}
      footer={
        <>
          {fileM.error && <span className="mr-auto self-center text-xs text-red-400">{fileM.error.message}</span>}
          <label className="mr-auto flex items-center gap-2 self-center text-xs text-gray-400" title="Off moves the page instead of copying it">
            <input type="checkbox" checked={keepDraft} onChange={(e) => setKeepDraft(e.target.checked)} className="accent-indigo-500" />
            Keep the draft in the Inbox
          </label>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800">Cancel</button>
        </>
      }
    >
      {seriesId === null ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5">
            <Search size={14} className="text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search series"
              className="flex-1 bg-transparent text-sm focus:outline-none"
            />
          </label>
          {seriesQ.isLoading ? (
            <Loader2 size={16} className="animate-spin text-gray-500" />
          ) : (seriesQ.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-500">No series yet — create one in Manage first.</p>
          ) : (
            <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
              {seriesQ.data?.map((entry) => (
                <li key={entry.id}>
                  <button
                    onClick={() => setSeriesId(entry.id)}
                    className="flex w-full items-center gap-2 bg-gray-950 px-3 py-2 text-left hover:bg-gray-900"
                  >
                    <BookOpen size={14} className="text-gray-600" />
                    <span className="truncate text-sm">{entry.title}</span>
                    <span className="ml-auto text-xs text-gray-500">{entry.chapters} ch</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <button onClick={() => setSeriesId(null)} className="text-xs text-indigo-300 hover:text-indigo-200">← Another series</button>
          {detailQ.isLoading ? (
            <Loader2 size={16} className="animate-spin text-gray-500" />
          ) : chapters.length === 0 ? (
            <p className="text-sm text-gray-500">This series has no chapters yet — add one in Manage.</p>
          ) : (
            <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    onClick={() => fileM.mutate(chapter.id)}
                    disabled={fileM.isPending}
                    className="flex w-full items-center gap-2 bg-gray-950 px-3 py-2 text-left hover:bg-gray-900 disabled:opacity-50"
                  >
                    <span className="truncate text-sm">
                      {chapter.number ? `${chapter.number}. ` : ""}
                      {chapter.title}
                    </span>
                    <span className="ml-auto text-xs text-gray-500">{chapter.pages} pg</span>
                    {fileM.isPending && fileM.variables === chapter.id && <Loader2 size={13} className="animate-spin text-gray-400" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
