import { useRef, useState } from "react";
import { ImageUp, Link2, Loader2, X } from "lucide-react";
import { createPage } from "../api";
import { usePageJobEvents } from "../hooks/usePageJobEvents";
import { JobProgress } from "./JobProgress";

type Source = "upload" | "url";

/** Reads a file as a data URL (the server accepts base64 with or without the prefix). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Creates a page job from an uploaded file or an image URL and follows its progress.
 * Calls `onCreated` with the page id once the translation finishes (or was already cached).
 */
export function NewPageDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (pageId: string) => void }) {
  const [source, setSource] = useState<Source>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [cleanSfx, setCleanSfx] = useState(false);
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const job = usePageJobEvents(jobId, (outcome) => {
    if (outcome === "done" && jobId) onCreated(jobId);
  });
  const running = jobId !== null && (job.status === "idle" || job.status === "running");
  const canSubmit = !submitting && !running && (source === "upload" ? file !== null : url.trim() !== "");

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setJobId(null);
    try {
      const body = source === "upload" && file
        ? { image: await fileToDataUrl(file), clean_sfx: cleanSfx, force }
        : { url: url.trim(), clean_sfx: cleanSfx, force };
      const { job_id } = await createPage(body);
      setJobId(job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const tab = (value: Source, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setSource(value)}
      disabled={submitting || running}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 ${
        source === value ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold">New page</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" title={running ? "Close (the job keeps running)" : "Close"}>
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-1">
            {tab("upload", <ImageUp size={14} />, "Upload")}
            {tab("url", <Link2 size={14} />, "Image URL")}
          </div>

          {source === "upload" ? (
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) setFile(dropped);
              }}
              className={`flex flex-col items-center justify-center gap-1 h-32 rounded-lg border-2 border-dashed cursor-pointer text-sm transition-colors ${
                dragOver ? "border-indigo-500 bg-indigo-500/10" : "border-gray-700 hover:border-gray-500"
              }`}
            >
              <ImageUp size={20} className="text-gray-500" />
              {file ? <span className="text-gray-200 truncate max-w-full px-4">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span> : <span className="text-gray-500">Drop an image or click to choose</span>}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && void submit()}
              placeholder="https://example.com/page-001.jpg"
              className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          )}

          <div className="flex flex-wrap gap-4 text-sm text-gray-300">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={cleanSfx} onChange={(e) => setCleanSfx(e.target.checked)} />
              Clean sound effects
            </label>
            <label className="flex items-center gap-2" title="Translate again even if this image was translated before">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Run again if already translated
            </label>
          </div>

          {jobId && <JobProgress job={job} />}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-800">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-800">
            {running ? "Close" : "Cancel"}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {(submitting || running) && <Loader2 size={14} className="animate-spin" />}
            {running ? "Translating…" : "Translate"}
          </button>
        </div>
      </div>
    </div>
  );
}
