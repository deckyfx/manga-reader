import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { getHealth, getSettings } from "../api";

function ReadyIcon({ ready }: { ready: boolean | "disabled" }) {
  if (ready === "disabled") return <span className="text-xs text-gray-600">disabled</span>;
  return ready
    ? <CheckCircle2 size={14} className="text-emerald-400" />
    : <XCircle size={14} className="text-red-400" />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">{title}</h2>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const healthQ = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 5000 });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const health = healthQ.data;
  const settings = settingsQ.data;

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      <h1 className="text-base font-semibold">Settings</h1>

      {/* Server health */}
      <Section title="Server health">
        {healthQ.isLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : healthQ.isError ? (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={14} /> Failed to load server health
          </div>
        ) : health ? (
          <div className="grid grid-cols-2 gap-2 text-sm">
            {([
              ["Status", health.status],
              ["OCR", health.ocr],
              ["Translate", health.translate],
              ["Dictionary", health.dictionary],
              ["Inpaint", health.inpaint],
              ["Bubble", health.bubble],
              ["TextSeg", health.text_seg],
            ] as [string, boolean | string | "disabled"][]).map(([label, val]) => (
              <div key={label} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
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
        ) : null}
      </Section>

      {/* Model settings */}
      {settingsQ.isLoading ? (
        <Section title="Models">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        </Section>
      ) : settingsQ.isError ? (
        <Section title="Models">
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={14} /> Failed to load model settings
          </div>
        </Section>
      ) : settings && (
        <Section title="Models">
          <div className="flex flex-col gap-2 text-sm">
            {(["ocr", "translate", "inpaint", "bubble", "text_seg"] as const).map((key) => {
              const m = settings[key];
              return (
                <div key={key} className="bg-gray-800 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-200 capitalize">{key.replace("_", " ")}</span>
                    <ReadyIcon ready={m.enabled ? m.ready : "disabled"} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 font-mono truncate">{m.repo}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Translation engine */}
      {settingsQ.isLoading ? (
        <Section title="Translation">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        </Section>
      ) : settingsQ.isError ? (
        <Section title="Translation">
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={14} /> Failed to load translation settings
          </div>
        </Section>
      ) : settings && (
        <Section title="Translation">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
              <span className="text-gray-400">Engine</span>
              <span className="text-gray-200 font-medium">{settings.preferred_translation_engine}</span>
            </div>
            <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
              <span className="text-gray-400">DeepL configured</span>
              <ReadyIcon ready={settings.deepl_configured} />
            </div>
            <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
              <span className="text-gray-400">Inpaint engine</span>
              <span className="text-gray-200 font-medium">{settings.inpaint_engine}</span>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
