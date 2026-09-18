import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2, Upload, X } from "lucide-react";
import {
  createSeries,
  removeSeriesCover,
  seriesCoverUrl,
  updateSeries,
  uploadSeriesCover,
  type ReadingDirection,
  type SeriesDetail,
  type SeriesStatus,
  type SeriesSummary,
} from "../api";
import { Modal } from "./Modal";

const STATUSES: { value: SeriesStatus; label: string }[] = [
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
];

interface SeriesFormProps {
  /** The series to edit; leave out to create a new one. */
  series?: SeriesSummary;
  onClose: () => void;
  onSaved: (detail: SeriesDetail) => void;
}

const MAX_TAGS = 30;

const inputClass =
  "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none";

/** Create or edit a series: the metadata a reader browses by, plus its cover. Tags are stored lower-cased. */
export function SeriesForm({ series, onClose, onSaved }: SeriesFormProps) {
  const [title, setTitle] = useState(series?.title ?? "");
  const [author, setAuthor] = useState(series?.author ?? "");
  const [synopsis, setSynopsis] = useState(series?.synopsis ?? "");
  const [status, setStatus] = useState<SeriesStatus>((series?.status as SeriesStatus) ?? "ongoing");
  const [direction, setDirection] = useState<ReadingDirection>(series?.reading_direction ?? "rtl");
  const [tags, setTags] = useState<string[]>(series?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [coverCleared, setCoverCleared] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);

  const addTags = (raw: string) => {
    const parts = raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    // The server takes 30 at most; pasting a longer list keeps the first 30 rather than failing the save
    if (parts.length > 0) setTags((current) => [...new Set([...current, ...parts])].slice(0, MAX_TAGS));
    setTagDraft("");
  };

  // A cover upload that fails leaves the series created: remember it, so retrying edits that one instead of
  // creating a second series
  const createdId = useRef<number | null>(null);
  const qc = useQueryClient();
  // Closing after a half-finished save would otherwise leave the new series invisible until a reload
  useEffect(() => () => {
    if (createdId.current !== null) void qc.invalidateQueries({ queryKey: ["series"] });
  }, [qc]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim(),
        author: author.trim() || null,
        synopsis: synopsis.trim() || null,
        status,
        reading_direction: direction,
        tags,
      };
      const existingId = series?.id ?? createdId.current;
      let detail = existingId !== null && existingId !== undefined ? await updateSeries(existingId, body) : await createSeries(body);
      createdId.current = detail.series.id;
      if (coverCleared && !cover) detail = await removeSeriesCover(detail.series.id);
      if (cover) detail = await uploadSeriesCover(detail.series.id, cover);
      return detail;
    },
    onSuccess: onSaved,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) save.mutate();
  };

  // A picked file is previewed from an object URL, which is released when the pick changes or the form closes
  const picked = useMemo(() => (cover ? URL.createObjectURL(cover) : null), [cover]);
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked);
  }, [picked]);

  // What the cover box shows: a freshly picked file, the stored cover, or nothing
  const preview = picked ?? (!coverCleared && series?.has_cover ? seriesCoverUrl(series.id, series.updated_at) : null);

  return (
    <Modal
      title={series ? "Edit series" : "New series"}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          {save.error && <span className="mr-auto self-center text-xs text-red-400">{save.error.message}</span>}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800">Cancel</button>
          <button
            onClick={submit}
            disabled={!title.trim() || save.isPending}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            {series ? "Save" : "Create series"}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-wrap gap-5">
        <div className="w-40 shrink-0 space-y-2">
          <div className="flex aspect-2/3 items-center justify-center overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <BookOpen size={26} className="text-gray-700" />}
          </div>
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setCover(file);
              if (file) setCoverCleared(false);
              e.target.value = "";
            }}
            className="hidden"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => coverRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-800 px-2 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
            >
              <Upload size={12} />
              Cover
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => {
                  setCover(null);
                  setCoverCleared(true);
                }}
                title="Remove the cover (the first page is used instead)"
                aria-label="Remove the cover"
                className="rounded-lg bg-gray-800 px-2 py-1.5 text-gray-400 hover:bg-gray-700 hover:text-red-300"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="min-w-64 flex-1 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required className={inputClass} />
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="min-w-40 flex-1 space-y-1">
              <span className="text-xs text-gray-400">Author</span>
              <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} className={inputClass} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as SeriesStatus)} className={inputClass}>
                {STATUSES.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Reading direction</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value === "ltr" ? "ltr" : "rtl")} className={inputClass}>
                <option value="rtl">Right to left (manga)</option>
                <option value="ltr">Left to right</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Synopsis</span>
            <textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={4} maxLength={4000} className={`${inputClass} resize-y`} />
          </label>

          <div className="space-y-1">
            <span className="text-xs text-gray-400">Tags</span>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-700 bg-gray-950 p-2">
              {tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((entry) => entry !== tag))}
                    aria-label={`Remove ${tag}`}
                    className="text-gray-500 hover:text-red-300"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTags(tagDraft);
                  } else if (e.key === "Backspace" && !tagDraft) {
                    setTags(tags.slice(0, -1));
                  }
                }}
                onBlur={() => addTags(tagDraft)}
                placeholder={tags.length < MAX_TAGS ? "Add a tag…" : `${MAX_TAGS} tags is the limit`}
                disabled={tags.length >= MAX_TAGS}
                className="min-w-28 flex-1 bg-transparent text-sm text-gray-100 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
