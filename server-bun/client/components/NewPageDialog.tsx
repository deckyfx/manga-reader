import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ImageUp, Link2, Loader2, X, XCircle } from "lucide-react";
import { createPage, pageEventsUrl, type PageJobEvent } from "../api";

type Source = "upload" | "url";

interface LogLine {
  message: string;
  kind: "log" | "done" | "error";
}

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
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ value: number; step: string } | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<EventSource | null>(null);

  // Close the progress stream when the dialog goes away
  useEffect(() => () => streamRef.current?.close(), []);

  const canSubmit = !submitting && !running && (source === "upload" ? file !== null : url.trim() !== "");

  const follow = (pageId: string) => {
    setRunning(true);
    const es = new EventSource(pageEventsUrl(pageId));
    streamRef.current = es;
    es.onmessage = (event: MessageEvent<string>) => {
      const update = JSON.parse(event.data) as PageJobEvent;
      if (update.type === "progress") {
        setProgress({ value: update.progress, step: update.message });
      } else if (update.type === "log") {
        setProgress({ value: update.progress, step: update.message });
        setLines((prev) => [...prev, { message: update.message, kind: "log" }]);
      } else if (update.type === "done") {
        es.close();
        setLines((prev) => [...prev, { message: update.message, kind: "done" }]);
        setRunning(false);
        onCreated(pageId);
      } else {
        es.close();
        setLines((prev) => [...prev, { message: update.error, kind: "error" }]);
        setError(update.error);
        setRunning(false);
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      es.close();
      setError("Lost the connection to the progress stream — the page may still be translating; check the list");
      setRunning(false);
    };
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setLines([]);
    setProgress(null);
    try {
      const body = source === "upload" && file
        ? { image: await fileToDataUrl(file), clean_sfx: cleanSfx, force }
        : { url: url.trim(), clean_sfx: cleanSfx, force };
      const { job_id, cached } = await createPage(body);
      setLines([{ message: cached ? "Found a previous translation" : source === "upload" ? "Uploaded" : "Downloaded", kind: "log" }]);
      follow(job_id);
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

          {(lines.length > 0 || progress) && (
            <div className="space-y-2">
              {progress && running && (
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span className="truncate">{progress.step}</span>
                    <span>{Math.round(progress.value * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress.value * 100}%` }} />
                  </div>
                </div>
              )}
              <ul className="max-h-40 overflow-y-auto space-y-1 text-xs">
                {lines.map((line, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    {line.kind === "done" ? <CheckCircle2 size={12} className="text-emerald-400" />
                      : line.kind === "error" ? <XCircle size={12} className="text-red-400" />
                      : <span className="w-3 text-center text-gray-600">•</span>}
                    <span className={line.kind === "error" ? "text-red-300" : "text-gray-300"}>{line.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && !lines.some((l) => l.kind === "error") && <p className="text-sm text-red-400">{error}</p>}
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
