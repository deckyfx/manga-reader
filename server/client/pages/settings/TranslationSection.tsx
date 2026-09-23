import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { getSettings, patchEngine, patchInpaintEngine } from "../../api";
import { fieldClass } from "../../lib/styles";
import { ReadyIcon } from "./ReadyIcon";

/**
 * Which engine translates, and which one cleans text off the page. Chosen here rather than by whoever asks for a
 * translation: one server, one answer, and every client gets the same one.
 */
export function TranslationSection() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const settings = settingsQ.data;
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["settings"] });
  const translationM = useMutation({ mutationFn: patchEngine, onSuccess: invalidate });
  const inpaintM = useMutation({ mutationFn: patchInpaintEngine, onSuccess: invalidate });

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

  /** An engine nobody configured is shown, but can't be chosen: the reason it's missing is the useful part. */
  const engines: { value: string; label: string; ready: boolean }[] = [
    { value: "auto", label: "auto — the best one configured", ready: true },
    { value: "sugoi", label: settings.sugoi_configured ? "Sugoi" : "Sugoi — set SUGOI_URL (see tools/sugoi/)", ready: settings.sugoi_configured },
    { value: "deepl", label: settings.deepl_configured ? "DeepL" : "DeepL — set DEEPL_API_KEY", ready: settings.deepl_configured },
    { value: "local", label: "built-in model", ready: true },
  ];
  const saving = translationM.isPending || inpaintM.isPending;

  return (
    <div className="flex max-w-2xl flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800 px-3 py-2">
        <span className="text-gray-400">Engine</span>
        <select
          value={settings.preferred_translation_engine}
          onChange={(e) => translationM.mutate(e.target.value)}
          disabled={saving}
          className={fieldClass}
        >
          {engines.map((engine) => (
            <option key={engine.value} value={engine.value} disabled={!engine.ready}>{engine.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
        <span className="text-gray-400">DeepL configured</span>
        <ReadyIcon ready={settings.deepl_configured} />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
        <span className="text-gray-400" title="A Sugoi translation server of your own (see tools/sugoi/); set SUGOI_URL to use it">
          Sugoi {settings.sugoi_configured && <span className="font-mono text-xs text-gray-500">{settings.sugoi_url}</span>}
        </span>
        <ReadyIcon ready={settings.sugoi_configured} />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800 px-3 py-2">
        <span className="text-gray-400">Inpaint engine</span>
        <select
          value={settings.inpaint_engine}
          onChange={(e) => inpaintM.mutate(e.target.value)}
          disabled={saving}
          className={fieldClass}
        >
          {["auto", "lama", "flood_fill"].map((engine) => <option key={engine} value={engine}>{engine}</option>)}
        </select>
      </div>
      {(translationM.error ?? inpaintM.error) && (
        <p className="text-sm text-red-400">{(translationM.error ?? inpaintM.error)?.message}</p>
      )}
    </div>
  );
}
