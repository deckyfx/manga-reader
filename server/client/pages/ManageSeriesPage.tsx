import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Check, FolderPlus, Layers, Loader2, Plus, SquarePen, Trash2, X } from "lucide-react";
import {
  createChapter,
  createVolume,
  deleteChapter,
  deleteSeries,
  deleteVolume,
  getSeries,
  seriesCoverUrl,
  updateChapter,
  updateVolume,
  type ChapterSummary,
  type SeriesDetail,
  type VolumeWithChapters,
} from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { SeriesForm } from "../components/SeriesForm";

const STATUS_LABEL: Record<string, string> = { ongoing: "Ongoing", completed: "Completed", hiatus: "Hiatus" };
const inputClass = "rounded-lg border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none";

/** One series to manage: its metadata, its volumes and chapters. Pages are managed inside a chapter. */
export function ManageSeriesPage() {
  const { id = "" } = useParams();
  const seriesId = Number(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const seriesQ = useQuery({ queryKey: ["series", seriesId], queryFn: () => getSeries(seriesId), enabled: Number.isFinite(seriesId) });
  /** Every mutation here answers with the whole series, so the page refreshes from the response. */
  const applyDetail = (detail: SeriesDetail) => {
    qc.setQueryData(["series", seriesId], detail);
    void qc.invalidateQueries({ queryKey: ["series"], exact: false, refetchType: "none" });
  };

  const addVolumeM = useMutation({ mutationFn: (body: { title: string; number: string | null }) => createVolume({ series_id: seriesId, ...body }), onSuccess: applyDetail });
  const editVolumeM = useMutation({ mutationFn: ({ id: volumeId, ...body }: { id: number; title: string; number: string | null }) => updateVolume(volumeId, body), onSuccess: applyDetail });
  const removeVolumeM = useMutation({ mutationFn: (volumeId: number) => deleteVolume(volumeId), onSuccess: applyDetail });
  const addChapterM = useMutation({
    mutationFn: (body: { volume_id: number | null; title: string; number: string | null }) => createChapter({ series_id: seriesId, ...body }),
    onSuccess: applyDetail,
  });
  const editChapterM = useMutation({
    mutationFn: ({ id: chapterId, ...body }: { id: number; title?: string; number?: string | null; volume_id?: number | null }) => updateChapter(chapterId, body),
    onSuccess: applyDetail,
  });
  const removeChapterM = useMutation({
    mutationFn: (chapterId: number) => deleteChapter(chapterId),
    onSuccess: (detail) => {
      applyDetail(detail);
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
  const removeSeriesM = useMutation({
    mutationFn: () => deleteSeries(seriesId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      navigate("/manage");
    },
  });

  const busy = addVolumeM.isPending || editVolumeM.isPending || removeVolumeM.isPending || addChapterM.isPending || editChapterM.isPending || removeChapterM.isPending;
  const error = seriesQ.error ?? addVolumeM.error ?? editVolumeM.error ?? removeVolumeM.error ?? addChapterM.error ?? editChapterM.error ?? removeChapterM.error ?? removeSeriesM.error;

  const removeVolume = async (volume: VolumeWithChapters) => {
    const confirmed = await confirm({
      title: `Delete “${volume.title}”?`,
      message: volume.chapters.length > 0
        ? `Its ${volume.chapters.length} chapter${volume.chapters.length === 1 ? "" : "s"} stay in the series, listed outside any volume.`
        : "The volume is empty.",
      confirmLabel: "Delete volume",
      danger: true,
    });
    if (confirmed) removeVolumeM.mutate(volume.id);
  };

  const removeChapter = async (chapter: ChapterSummary) => {
    const confirmed = await confirm({
      title: `Delete “${chapter.title}”?`,
      message: chapter.pages > 0
        ? `Its ${chapter.pages} page${chapter.pages === 1 ? "" : "s"} keep their images and return to the Inbox.`
        : "The chapter is empty.",
      confirmLabel: "Delete chapter",
      danger: true,
    });
    if (confirmed) removeChapterM.mutate(chapter.id);
  };

  const removeSeries = async () => {
    const detail = seriesQ.data;
    if (!detail) return;
    const confirmed = await confirm({
      title: `Delete “${detail.series.title}”?`,
      message: "Its volumes and chapters go with it. The pages keep their images and return to the Inbox.",
      confirmLabel: "Delete series",
      danger: true,
    });
    if (confirmed) removeSeriesM.mutate();
  };

  if (seriesQ.isLoading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (!seriesQ.data) return <p className="m-4 text-sm text-red-400">{seriesQ.error?.message ?? "Series not found"}</p>;

  const { series, volumes, unsorted } = seriesQ.data;
  const volumeOptions = volumes.map((volume) => ({ id: volume.id, title: volume.title }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-4 py-3">
        <Link to="/manage" className="text-gray-400 hover:text-white" title="Back to the library">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="truncate text-base font-semibold">{series.title}</h1>
        {busy && <Loader2 size={14} className="animate-spin text-gray-500" />}
        {error && <span className="truncate text-xs text-red-400">{error.message}</span>}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700">
            <SquarePen size={14} />
            Edit
          </button>
          <Link to={`/read/series/${series.id}`} className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700">
            <BookOpen size={14} />
            Read
          </Link>
          <button
            onClick={() => void removeSeries()}
            disabled={removeSeriesM.isPending}
            title="Delete this series"
            aria-label="Delete this series"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-wrap gap-4 border-b border-gray-800 p-4">
          <div className="flex aspect-2/3 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
            {series.has_cover ? (
              <img src={seriesCoverUrl(series.id, series.updated_at)} alt="" className="h-full w-full object-cover" />
            ) : (
              <BookOpen size={24} className="text-gray-700" />
            )}
          </div>
          <div className="min-w-56 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span className="rounded bg-gray-800 px-2 py-0.5">{STATUS_LABEL[series.status] ?? series.status}</span>
              <span className="rounded bg-gray-800 px-2 py-0.5">{series.reading_direction === "rtl" ? "Right to left" : "Left to right"}</span>
              {series.author && <span>by {series.author}</span>}
              <span>{series.chapters} chapter{series.chapters === 1 ? "" : "s"}</span>
            </div>
            {series.synopsis && <p className="whitespace-pre-wrap text-sm text-gray-300">{series.synopsis}</p>}
            {series.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {series.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-400">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 p-4">
          {volumes.map((volume) => (
            <VolumeSection
              key={volume.id}
              volume={volume}
              volumeOptions={volumeOptions}
              onRename={(title, number) => editVolumeM.mutate({ id: volume.id, title, number })}
              onDelete={() => void removeVolume(volume)}
              onAddChapter={(title, number) => addChapterM.mutate({ volume_id: volume.id, title, number })}
              onEditChapter={(chapter, fields) => editChapterM.mutate({ id: chapter.id, ...fields })}
              onDeleteChapter={(chapter) => void removeChapter(chapter)}
            />
          ))}

          <section className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <Layers size={14} className="text-gray-500" />
              {volumes.length > 0 ? "Chapters outside a volume" : "Chapters"}
            </h2>
            <ChapterRows
              chapters={unsorted}
              volumeOptions={volumeOptions}
              onEditChapter={(chapter, fields) => editChapterM.mutate({ id: chapter.id, ...fields })}
              onDeleteChapter={(chapter) => void removeChapter(chapter)}
            />
            <AddRow
              label="Add chapter"
              titlePlaceholder="Chapter title"
              onAdd={(title, number) => addChapterM.mutate({ volume_id: null, title, number })}
            />
          </section>

          <section className="border-t border-gray-800 pt-4">
            <AddRow label="Add volume" titlePlaceholder="Volume title" icon={<FolderPlus size={13} />} onAdd={(title, number) => addVolumeM.mutate({ title, number })} />
          </section>
        </div>
      </div>

      {editing && (
        <SeriesForm
          series={series}
          onClose={() => setEditing(false)}
          onSaved={(detail) => {
            setEditing(false);
            applyDetail(detail);
            void qc.invalidateQueries({ queryKey: ["series-tags"] });
          }}
        />
      )}
    </div>
  );
}

interface VolumeSectionProps {
  volume: VolumeWithChapters;
  volumeOptions: { id: number; title: string }[];
  onRename: (title: string, number: string | null) => void;
  onDelete: () => void;
  onAddChapter: (title: string, number: string | null) => void;
  onEditChapter: (chapter: ChapterSummary, fields: { title?: string; number?: string | null; volume_id?: number | null }) => void;
  onDeleteChapter: (chapter: ChapterSummary) => void;
}

/** A volume with its chapters, renameable in place. */
function VolumeSection({ volume, volumeOptions, onRename, onDelete, onAddChapter, onEditChapter, onDeleteChapter }: VolumeSectionProps) {
  const [renaming, setRenaming] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {renaming ? (
          <NameFields
            title={volume.title}
            number={volume.number}
            onCancel={() => setRenaming(false)}
            onSave={(title, number) => {
              setRenaming(false);
              onRename(title, number);
            }}
          />
        ) : (
          <>
            <h2 className="text-sm font-semibold text-gray-300">
              {volume.number ? `Volume ${volume.number} · ` : ""}
              {volume.title}
            </h2>
            <span className="text-xs text-gray-500">{volume.chapters.length} chapter{volume.chapters.length === 1 ? "" : "s"}</span>
            <button onClick={() => setRenaming(true)} aria-label={`Rename ${volume.title}`} title="Rename" className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white">
              <SquarePen size={13} />
            </button>
            <button onClick={onDelete} aria-label={`Delete ${volume.title}`} title="Delete volume" className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300">
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      <ChapterRows chapters={volume.chapters} volumeOptions={volumeOptions} onEditChapter={onEditChapter} onDeleteChapter={onDeleteChapter} />
      <AddRow label="Add chapter" titlePlaceholder="Chapter title" onAdd={onAddChapter} />
    </section>
  );
}

interface ChapterRowsProps {
  chapters: ChapterSummary[];
  volumeOptions: { id: number; title: string }[];
  onEditChapter: (chapter: ChapterSummary, fields: { title?: string; number?: string | null; volume_id?: number | null }) => void;
  onDeleteChapter: (chapter: ChapterSummary) => void;
}

function ChapterRows({ chapters, volumeOptions, onEditChapter, onDeleteChapter }: ChapterRowsProps) {
  const [renaming, setRenaming] = useState<number | null>(null);

  if (chapters.length === 0) return <p className="text-xs text-gray-600">No chapters here yet.</p>;

  return (
    <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
      {chapters.map((chapter) => (
        <li key={chapter.id} className="flex flex-wrap items-center gap-2 bg-gray-900 px-3 py-2">
          {renaming === chapter.id ? (
            <NameFields
              title={chapter.title}
              number={chapter.number}
              onCancel={() => setRenaming(null)}
              onSave={(title, number) => {
                setRenaming(null);
                onEditChapter(chapter, { title, number });
              }}
            />
          ) : (
            <>
              <Link to={`/manage/chapters/${chapter.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-indigo-300">
                {chapter.number ? `${chapter.number}. ` : ""}
                {chapter.title}
              </Link>
              <span className="text-xs text-gray-500">{chapter.pages} pg</span>
              {volumeOptions.length > 0 && (
                <select
                  value={chapter.volume_id ?? ""}
                  onChange={(e) => onEditChapter(chapter, { volume_id: e.target.value === "" ? null : Number(e.target.value) })}
                  aria-label={`Volume of ${chapter.title}`}
                  title="Move to a volume"
                  className="rounded-md border border-gray-700 bg-gray-950 px-1.5 py-1 text-xs text-gray-300"
                >
                  <option value="">No volume</option>
                  {volumeOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.title}</option>
                  ))}
                </select>
              )}
              <button onClick={() => setRenaming(chapter.id)} aria-label={`Rename ${chapter.title}`} title="Rename" className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white">
                <SquarePen size={13} />
              </button>
              {chapter.pages > 0 && (
                <Link to={`/read/chapters/${chapter.id}/pages/1`} aria-label={`Read ${chapter.title}`} title="Read" className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white">
                  <BookOpen size={13} />
                </Link>
              )}
              <button onClick={() => onDeleteChapter(chapter)} aria-label={`Delete ${chapter.title}`} title="Delete chapter" className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Title + number fields shared by renaming a volume and renaming a chapter. */
function NameFields({ title, number, onSave, onCancel }: { title: string; number: string | null; onSave: (title: string, number: string | null) => void; onCancel: () => void }) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftNumber, setDraftNumber] = useState(number ?? "");

  const save = () => {
    if (draftTitle.trim()) onSave(draftTitle.trim(), draftNumber.trim() || null);
  };

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <input
        autoFocus
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        aria-label="Title"
        maxLength={200}
        className={`min-w-40 flex-1 ${inputClass}`}
      />
      <input
        value={draftNumber}
        onChange={(e) => setDraftNumber(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onCancel();
        }}
        aria-label="Number"
        placeholder="No."
        maxLength={20}
        className={`w-20 ${inputClass}`}
      />
      <button onClick={save} disabled={!draftTitle.trim()} aria-label="Save" title="Save" className="rounded p-1.5 text-emerald-400 hover:bg-gray-800 disabled:opacity-40">
        <Check size={14} />
      </button>
      <button onClick={onCancel} aria-label="Cancel" title="Cancel" className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white">
        <X size={14} />
      </button>
    </div>
  );
}

/** A one-line "add" form: a title, an optional number, and a button. */
function AddRow({ label, titlePlaceholder, icon, onAdd }: { label: string; titlePlaceholder: string; icon?: React.ReactNode; onAdd: (title: string, number: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title.trim(), number.trim() || null);
    setTitle("");
    setNumber("");
  };

  return (
    <form onSubmit={add} className="flex flex-wrap items-center gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={titlePlaceholder} maxLength={200} aria-label={titlePlaceholder} className={`min-w-44 flex-1 ${inputClass}`} />
      <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="No." maxLength={20} aria-label="Number" className={`w-20 ${inputClass}`} />
      <button
        type="submit"
        disabled={!title.trim()}
        className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-40"
      >
        {icon ?? <Plus size={13} />}
        {label}
      </button>
    </form>
  );
}
