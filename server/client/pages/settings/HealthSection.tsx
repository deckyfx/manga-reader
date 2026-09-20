import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { getHealth } from "../../api";
import { when } from "../../lib/format";
import { ReadyIcon } from "./ReadyIcon";

/** What the server has finished loading, and what it is running. */
export function HealthSection() {
  const healthQ = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 5000 });
  const health = healthQ.data;

  if (healthQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }
  if (healthQ.isError || !health) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <AlertCircle size={14} /> Failed to load server health
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {([
          ["Status", health.status],
          ["OCR", health.ocr],
          ["Translate", health.translate],
          ["Dictionary", health.dictionary],
          ["Inpaint", health.inpaint],
          ["Bubble", health.bubble],
          ["TextSeg", health.text_seg],
        ] as [string, boolean | string | "disabled"][]).map(([label, val]) => (
          <div key={label} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
            <span className="text-gray-400">{label}</span>
            {typeof val === "string"
              ? <span className={`text-xs font-medium ${
                  val === "ready" ? "text-emerald-400" : val === "starting" ? "text-yellow-400" : "text-orange-400"
                }`}>{val}</span>
              : <ReadyIcon ready={val} />
            }
          </div>
        ))}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-gray-800 pt-3 text-xs text-gray-500">
        <div className="flex gap-1.5">
          <dt>Server</dt>
          <dd className="text-gray-300">v{health.version.server}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Bun</dt>
          <dd className="text-gray-300">{health.version.bun}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Up since</dt>
          <dd className="text-gray-300">{when(health.version.started_at)}</dd>
        </div>
      </dl>
    </div>
  );
}
