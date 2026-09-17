import { CheckCircle2, XCircle } from "lucide-react";
import type { PageJobProgress } from "../hooks/usePageJobEvents";

/** Progress bar and log lines of a running page job. */
export function JobProgress({ job, maxLogHeight = "max-h-40" }: { job: PageJobProgress; maxLogHeight?: string }) {
  return (
    <div className="space-y-2">
      {job.status === "running" && (
        <div>
          <div className="flex justify-between gap-3 text-xs text-gray-400 mb-1">
            <span className="truncate">{job.step}</span>
            <span>{Math.round(job.progress * 100)}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.progress * 100}%` }} />
          </div>
        </div>
      )}
      {job.lines.length > 0 && (
        <ul className={`${maxLogHeight} overflow-y-auto space-y-1 text-xs`}>
          {job.lines.map((line, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {line.kind === "done" ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                : line.kind === "error" ? <XCircle size={12} className="text-red-400 shrink-0" />
                : <span className="w-3 text-center text-gray-600 shrink-0">•</span>}
              <span className={line.kind === "error" ? "text-red-300" : "text-gray-300"}>{line.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
