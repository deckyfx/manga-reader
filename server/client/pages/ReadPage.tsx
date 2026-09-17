import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Library, Loader2, Plus, Trash2 } from "lucide-react";
import { createVolume, deleteVolume, listVolumes, type ReadingDirection } from "../api";
import { useConfirm } from "../components/ConfirmDialog";

/** The library: volumes to read, each holding chapters of pages. */
export function ReadPage() {
  const qc = useQueryClient();
  const volumesQ = useQuery({ queryKey: ["volumes"], queryFn: listVolumes });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState<ReadingDirection>("rtl");
  const confirm = useConfirm();

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["volumes"] });
  const createM = useMutation({
    mutationFn: () => createVolume({ title: title.trim(), reading_direction: direction }),
    onSuccess: () => {
      setTitle("");
      setAdding(false);
      invalidate();
    },
  });
  const deleteM = useMutation({ mutationFn: (id: number) => deleteVolume(id), onSuccess: invalidate });

  const removeVolume = async (id: number, name: string) => {
    const confirmed = await confirm({
      title: `Delete “${name}”?`,
      message: "Its chapters are removed. The pages themselves are kept and return to the Studio inbox.",
      confirmLabel: "Delete volume",
      danger: true,
    });
    if (confirmed) deleteM.mutate(id);
  };

  const volumes = volumesQ.data ?? [];
  const error = volumesQ.error ?? createM.error ?? deleteM.error;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
        <Library size={18} className="text-gray-400" />
        <h1 className="text-base font-semibold">Library</h1>
        <span className="text-xs text-gray-500">{volumes.length} volume{volumes.length === 1 ? "" : "s"}</span>
        {error && <span className="text-xs text-red-400">{error.message}</span>}
        <button
          onClick={() => setAdding((open) => !open)}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus size={14} />
          New volume
        </button>
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) createM.mutate();
          }}
          className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-800 bg-gray-900/60"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Volume title"
            maxLength={200}
            className="flex-1 min-w-48 bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
          />
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Reading
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value === "ltr" ? "ltr" : "rtl")}
              className="bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-gray-200"
            >
              <option value="rtl">Right to left (manga)</option>
              <option value="ltr">Left to right</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={!title.trim() || createM.isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
          >
            {createM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create
          </button>
          <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
        </form>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {volumesQ.isLoading ? (
          <Loader2 className="animate-spin text-gray-500" />
        ) : volumes.length === 0 ? (
          <p className="text-sm text-gray-500">No volumes yet. Create one, then add chapters and upload pages (images or a ZIP / CBZ).</p>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {volumes.map((volume) => (
              <div key={volume.id} className="group relative bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-indigo-500/60 transition-colors">
                <Link to={`/read/volumes/${volume.id}`} className="block">
                  <div className="flex items-center gap-2">
                    <BookOpen size={15} className="text-indigo-400 shrink-0" />
                    <span className="font-medium truncate">{volume.title}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                    <span>{volume.chapters} chapter{volume.chapters === 1 ? "" : "s"}</span>
                    <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{volume.reading_direction === "rtl" ? "RTL" : "LTR"}</span>
                  </div>
                </Link>
                <button
                  onClick={() => void removeVolume(volume.id, volume.title)}
                  disabled={deleteM.isPending}
                  title="Delete this volume"
                  aria-label={`Delete ${volume.title}`}
                  className="absolute top-2 right-2 p-1 rounded text-gray-500 opacity-0 group-hover:opacity-100 hover:bg-red-900/60 hover:text-red-200 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
