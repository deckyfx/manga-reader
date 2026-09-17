import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { createChapter, deleteChapter, getVolume, updateChapter, updateVolume, type ChapterSummary, type ReadingDirection } from "../api";
import { useConfirm } from "../components/ConfirmDialog";

/** One volume: its chapters, with renaming, reordering by number and the reading direction. */
export function VolumePage() {
  const { id = "" } = useParams();
  const volumeId = Number(id);
  const qc = useQueryClient();
  const volumeQ = useQuery({ queryKey: ["volume", volumeId], queryFn: () => getVolume(volumeId), enabled: Number.isFinite(volumeId) });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["volume", volumeId] });
    void qc.invalidateQueries({ queryKey: ["volumes"] });
  };

  const [chapterTitle, setChapterTitle] = useState("");
  const createM = useMutation({
    mutationFn: () => createChapter({ volume_id: volumeId, title: chapterTitle.trim() }),
    onSuccess: () => {
      setChapterTitle("");
      invalidate();
    },
  });
  const volumeM = useMutation({
    mutationFn: (body: { title?: string; reading_direction?: ReadingDirection }) => updateVolume(volumeId, body),
    onSuccess: invalidate,
  });
  const deleteChapterM = useMutation({ mutationFn: (chapterId: number) => deleteChapter(chapterId), onSuccess: invalidate });
  const confirm = useConfirm();

  const volume = volumeQ.data?.volume;
  const chapters = volumeQ.data?.chapters ?? [];
  const error = volumeQ.error ?? createM.error ?? volumeM.error ?? deleteChapterM.error;

  const removeChapter = async (chapter: ChapterSummary) => {
    const confirmed = await confirm({
      title: `Delete “${chapter.title}”?`,
      message: `Its ${chapter.pages} page${chapter.pages === 1 ? "" : "s"} are kept and return to the Studio inbox.`,
      confirmLabel: "Delete chapter",
      danger: true,
    });
    if (confirmed) deleteChapterM.mutate(chapter.id);
  };

  if (volumeQ.isLoading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (!volume) return <p className="m-4 text-sm text-red-400">{volumeQ.error?.message ?? "Volume not found"}</p>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
        <Link to="/read" className="text-gray-400 hover:text-white" title="Library">
          <ArrowLeft size={18} />
        </Link>
        <EditableTitle value={volume.title} onSave={(title) => volumeM.mutate({ title })} />
        <label className="flex items-center gap-2 text-xs text-gray-400">
          Reading
          <select
            value={volume.reading_direction}
            onChange={(e) => volumeM.mutate({ reading_direction: e.target.value === "ltr" ? "ltr" : "rtl" })}
            className="bg-gray-950 border border-gray-700 rounded-md px-2 py-1 text-gray-200"
          >
            <option value="rtl">Right to left (manga)</option>
            <option value="ltr">Left to right</option>
          </select>
        </label>
        {volumeM.isPending && <Loader2 size={14} className="animate-spin text-gray-500" />}
        {error && <span className="text-xs text-red-400">{error.message}</span>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (chapterTitle.trim()) createM.mutate();
        }}
        className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-800 bg-gray-900/40"
      >
        <input
          value={chapterTitle}
          onChange={(e) => setChapterTitle(e.target.value)}
          placeholder={`Chapter ${chapters.length + 1}`}
          maxLength={200}
          className="flex-1 min-w-48 bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={!chapterTitle.trim() || createM.isPending}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
        >
          {createM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add chapter
        </button>
      </form>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        {chapters.length === 0 ? (
          <p className="text-sm text-gray-500">No chapters yet. Add one, then upload its pages as images or a ZIP / CBZ.</p>
        ) : (
          chapters.map((chapter) => (
            <div key={chapter.id} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
              <BookOpen size={15} className="text-indigo-400 shrink-0" />
              <Link to={`/read/chapters/${chapter.id}`} className="font-medium truncate hover:text-indigo-300">
                {chapter.title}
              </Link>
              <span className="text-xs text-gray-500">{chapter.pages} page{chapter.pages === 1 ? "" : "s"}</span>
              <span className="ml-auto flex items-center gap-1">
                {chapter.pages > 0 && (
                  <Link
                    to={`/read/chapters/${chapter.id}/pages/1`}
                    className="px-2 py-1 rounded-md text-xs text-gray-300 hover:bg-gray-800"
                    title="Read this chapter"
                  >
                    Read
                  </Link>
                )}
                <ChapterRename chapter={chapter} onDone={invalidate} />
                <button
                  onClick={() => void removeChapter(chapter)}
                  disabled={deleteChapterM.isPending}
                  title="Delete this chapter"
                  aria-label={`Delete ${chapter.title}`}
                  className="p-1.5 rounded-md text-gray-400 hover:bg-red-900/60 hover:text-red-200 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** A title that turns into an input when the pencil is clicked. */
function EditableTitle({ value, onSave }: { value: string; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <h1 className="flex items-center gap-2 text-base font-semibold truncate">
        {value}
        <button onClick={() => setEditing(true)} title="Rename" aria-label="Rename" className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800">
          <Pencil size={13} />
        </button>
      </h1>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim() && draft !== value) onSave(draft.trim());
        setEditing(false);
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        maxLength={200}
        className="bg-gray-950 border border-gray-700 rounded-md px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
      />
      <button type="submit" onMouseDown={(e) => e.preventDefault()} title="Save" className="p-1 rounded text-indigo-300 hover:bg-gray-800">
        <Check size={14} />
      </button>
    </form>
  );
}

function ChapterRename({ chapter, onDone }: { chapter: ChapterSummary; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chapter.title);
  const renameM = useMutation({
    mutationFn: (title: string) => updateChapter(chapter.id, { title }),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
  });
  useEffect(() => setDraft(chapter.title), [chapter.title]);

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} title="Rename this chapter" aria-label={`Rename ${chapter.title}`} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800 hover:text-white">
        <Pencil size={14} />
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim() && draft !== chapter.title) renameM.mutate(draft.trim());
        else setEditing(false);
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        maxLength={200}
        className="w-40 bg-gray-950 border border-gray-700 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
      />
      <button type="submit" onMouseDown={(e) => e.preventDefault()} title="Save" className="p-1 rounded text-indigo-300 hover:bg-gray-800">
        {renameM.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
      </button>
    </form>
  );
}
