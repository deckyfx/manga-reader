import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { getSettings, patchEngine, patchInpaintEngine } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { fieldClass } from "../../lib/styles";
import { ReadyIcon } from "./ReadyIcon";

/**
 * Which engine translates, and which one cleans text off the page. Chosen here rather than by whoever asks for a
 * translation: one server, one answer, and every client gets the same one.
 */
export function TranslationSection() {
  const qc = useQueryClient();
  // The engine is the whole server's, and it is remembered: an admin chooses it. Everyone else can see what it is.
  const { can } = useAuth();
  const mayChange = can("admin");
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
  const localReady = settings.translate.enabled && settings.translate.ready;
  const localLabel = settings.translate.enabled
    ? localReady ? "built-in model" : "built-in model — still loading, or it failed to load"
    : "built-in model — set TRANSLATE_MODEL_ENABLED";
  const engines: { value: string; label: string; ready: boolean }[] = [
    { value: "auto", label: "auto — the best one configured", ready: true },
    { value: "sugoi", label: settings.sugoi_configured ? "Sugoi" : "Sugoi — set SUGOI_URL (see tools/sugoi/)", ready: settings.sugoi_configured },
    { value: "deepl", label: settings.deepl_configured ? "DeepL" : "DeepL — set DEEPL_API_KEY", ready: settings.deepl_configured },
    // Choosing it while it isn't loaded would set the server to an engine that answers 503
    { value: "local", label: localLabel, ready: localReady },
  ];
  const saving = translationM.isPending || inpaintM.isPending || !mayChange;

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
      {!mayChange && <p className="text-xs text-gray-500">Only an admin can change which engine this server uses.</p>}
      {(translationM.error ?? inpaintM.error) && (
        <p className="text-sm text-red-400">{(translationM.error ?? inpaintM.error)?.message}</p>
      )}
    </div>
  );
}
