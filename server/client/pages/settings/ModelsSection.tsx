import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { getSettings } from "../../api";
import { ReadyIcon } from "./ReadyIcon";

/** Which model each stage of the pipeline loads, and whether it is up. */
export function ModelsSection() {
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const settings = settingsQ.data;

  if (settingsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }
  if (settingsQ.isError || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <AlertCircle size={14} /> Failed to load model settings
      </div>
    );
  }

  return (
    <div className="grid max-w-4xl gap-2 text-sm sm:grid-cols-2">
      {(["ocr", "translate", "inpaint", "bubble", "text_seg"] as const).map((key) => {
        const model = settings[key];
        return (
          <div key={key} className="rounded-lg bg-gray-800 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-200 capitalize">{key.replace("_", " ")}</span>
              <ReadyIcon ready={model.enabled ? model.ready : "disabled"} />
            </div>
            <div className="mt-0.5 truncate font-mono text-xs text-gray-500">{model.repo}</div>
          </div>
        );
      })}
    </div>
  );
}
