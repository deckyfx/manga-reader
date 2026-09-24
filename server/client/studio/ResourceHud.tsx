import { Activity, X } from "lucide-react";
import { useResourceStream } from "../hooks/useResourceStream";
import { readHudOpen, saveHudOpen } from "../lib/editor-prefs";
import { useState } from "react";
import type { ResourceSample } from "../../src/services/resource-monitor";

/** The graph's height in its own coordinates; the path is drawn in these and scaled by CSS. */
const H = 36;
const W = 120;

/** A sparkline path for values already scaled to 0–1, oldest first. */
function spark(values: number[]): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? W / (values.length - 1) : W;
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - v * H).toFixed(1)}`).join(" ");
}

const gb = (bytes: number): string => `${(bytes / 1_073_741_824).toFixed(1)} GB`;

/** One reading with its own graph. */
function Meter({ label, value, detail, values, tint }: { label: string; value: string; detail?: string; values: number[]; tint: string }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-24 shrink-0" preserveAspectRatio="none" aria-hidden>
        <path d={spark(values)} fill="none" stroke={tint} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
        <div className="font-mono text-sm text-gray-200">{value}</div>
        {detail && <div className="truncate text-[11px] text-gray-500">{detail}</div>}
      </div>
    </div>
  );
}

/**
 * What the machine is doing, over the Studio page, while a page is being worked on.
 *
 * Closed by default and closed means closed: no stream, and the server stops sampling once nobody is watching.
 */
export function ResourceHud() {
  const [open, setOpen] = useState(readHudOpen);
  const show = (next: boolean): void => {
    setOpen(next);
    saveHudOpen(next);
  };
  const { samples, latest, connected } = useResourceStream(open);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => show(true)}
        title="Show what the machine is doing"
        className="fixed bottom-4 right-4 z-40 rounded-full bg-gray-800/90 p-2.5 text-gray-400 shadow-lg ring-1 ring-gray-700 hover:text-gray-200"
      >
        <Activity size={16} />
      </button>
    );
  }

  const ceiling = (latest?.cores ?? 1) * 100;
  const cpu = samples.map((s: ResourceSample) => Math.min(1, s.cpu / ceiling));
  // Memory is drawn against the most this server has held while the graph has been watching, since the floor is
  // the models and never comes back to zero: the shape of the change is the useful part
  const peakRss = Math.max(1, ...samples.map((s: ResourceSample) => s.rss));
  const rss = samples.map((s: ResourceSample) => s.rss / peakRss);
  const gpu = samples.map((s: ResourceSample) => (s.gpu ?? 0) / 100);

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 rounded-xl bg-gray-900/95 p-3 shadow-xl ring-1 ring-gray-700 backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
          <Activity size={13} className={connected ? "text-emerald-400" : "text-gray-600"} />
          {latest?.work ?? (connected ? "idle" : "not connected")}
        </span>
        <button type="button" onClick={() => show(false)} title="Hide" className="text-gray-500 hover:text-gray-300">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <Meter
          label="CPU"
          value={latest ? `${Math.round(latest.cpu)}%` : "—"}
          detail={latest ? `of ${ceiling}% · ${latest.cores} cores` : undefined}
          values={cpu}
          tint="#34d399"
        />
        <Meter
          label="Memory"
          value={latest ? gb(latest.rss) : "—"}
          detail={samples.length > 1 ? `peak ${gb(peakRss)} while watching` : undefined}
          values={rss}
          tint="#60a5fa"
        />
        <Meter
          label="GPU"
          value={latest?.gpu === null || latest === null ? "n/a" : `${Math.round(latest.gpu)}%`}
          detail={latest?.vramUsed != null && latest.vramTotal ? `vram ${gb(latest.vramUsed)} of ${gb(latest.vramTotal)}` : "no GPU reading on this machine"}
          values={gpu}
          tint="#f472b6"
        />
      </div>
    </div>
  );
}
