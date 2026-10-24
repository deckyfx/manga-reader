/**
 * The page editor's threshold overrides: for the page the pipeline's defaults don't suit. A value saved here marks
 * what it outdates stale, so the Clean buttons say so; detector confidence waits for Run again.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, SlidersHorizontal } from "lucide-react";
import { setPageTuning, type StudioPageDetail } from "../../api";
import { TUNING_KNOBS, type PageTuning, type TuningKey } from "../../../src/shared/page-tuning";
import { NumberField } from "./StyleEditor";

/** Typing "24" reports 2 then 24: a save waits this long for the number to settle. */
const SAVE_DELAY_MS = 500;

export function TuningPanel({ pageId, tuning, disabled, onChanged }: {
  pageId: string;
  tuning: PageTuning;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
}) {
  const overridden = TUNING_KNOBS.filter((knob) => tuning[knob.key] !== undefined).length;
  // Open by itself on a page somebody has tuned, so the overrides aren't forgotten behind a fold
  const [open, setOpen] = useState(overridden > 0);
  const saveM = useMutation({
    mutationFn: (changes: { [K in TuningKey]?: number | null }) => setPageTuning(pageId, changes),
    onSuccess: onChanged,
  });

  const timers = useRef(new Map<TuningKey, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);
  const change = (key: TuningKey, value: number | undefined) => {
    clearTimeout(timers.current.get(key));
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      saveM.mutate({ [key]: value ?? null });
    }, SAVE_DELAY_MS));
  };

  return (
    <div className="pt-2 border-t border-gray-800 space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-xs text-gray-400 hover:text-gray-200"
        title="Thresholds for this page only, where the defaults don't suit it"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <SlidersHorizontal size={13} /> Page tuning
        {overridden > 0 && <span className="text-amber-400">{overridden} set</span>}
        {saveM.isPending && <Loader2 size={12} className="animate-spin text-gray-500" />}
      </button>
      {open && (
        <div className="space-y-2.5 text-xs text-gray-300">
          {saveM.error && <p className="text-red-400">{saveM.error.message}</p>}
          {TUNING_KNOBS.map((knob) => (
            <div key={knob.key} className="space-y-0.5">
              <NumberField
                label={knob.label}
                value={tuning[knob.key]}
                min={knob.min}
                max={knob.max}
                step={knob.step}
                placeholder={knob.default === null ? "auto" : String(knob.default)}
                disabled={disabled}
                onChange={(value) => change(knob.key, value)}
              />
              <p className="text-[11px] text-gray-500">
                {knob.hint}. Empty is the default{knob.defaultNote ? ` (${knob.defaultNote})` : ""}.
                {knob.appliesOn && <> Takes effect on {knob.appliesOn}.</>}
              </p>
            </div>
          ))}
          {overridden > 0 && (
            <button
              disabled={disabled || saveM.isPending}
              onClick={() => saveM.mutate(Object.fromEntries(TUNING_KNOBS.map((knob) => [knob.key, null])))}
              className="text-gray-400 hover:text-gray-50 disabled:opacity-40"
            >
              Back to the defaults
            </button>
          )}
        </div>
      )}
    </div>
  );
}
