import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { getSettings } from "../../api";
import { ReadyIcon } from "./ReadyIcon";

/** Which engine translates, and which one cleans text off the page. */
export function TranslationSection() {
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
        <AlertCircle size={14} /> Failed to load translation settings
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-2 text-sm">
      <div className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
        <span className="text-gray-400">Engine</span>
        <span className="font-medium text-gray-200">{settings.preferred_translation_engine}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
        <span className="text-gray-400">DeepL configured</span>
        <ReadyIcon ready={settings.deepl_configured} />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
        <span className="text-gray-400">Inpaint engine</span>
        <span className="font-medium text-gray-200">{settings.inpaint_engine}</span>
      </div>
    </div>
  );
}
