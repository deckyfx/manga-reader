/**
 * The page editor's threshold overrides: for the page the pipeline's defaults don't suit. A value saved here marks
 * what it outdates stale, so the Clean buttons say so; detector confidence waits for Run again.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, SlidersHorizontal } from "lucide-react";
import { setPageTuning, type StudioPageDetail } from "../../api";
import { PendingChanges } from "../../lib/pending-changes";
import { TUNING_KNOBS, type PageTuning, type TuningKey } from "../../../src/shared/page-tuning";
import { NumberField } from "./StyleEditor";

/** Typing "24" reports 2 then 24: a save waits this long for the number to settle. */
const SAVE_DELAY_MS = 500;

type Changes = { [K in TuningKey]?: number | null };

export function TuningPanel({ pageId, tuning, disabled, onChanged, trackSave, registerFlush }: {
  pageId: string;
  tuning: PageTuning;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  /** Registers a save in flight, so the editor's actions wait for it. */
  trackSave: (save: Promise<unknown>) => void;
  /** Lets the editor send edits still waiting before an action; returns the way to unregister. */
  registerFlush: (flush: () => void) => () => void;
}) {
  const overridden = TUNING_KNOBS.filter((knob) => tuning[knob.key] !== undefined).length;
  // Open by itself on a page somebody has tuned, so the overrides aren't forgotten behind a fold
  const [open, setOpen] = useState(overridden > 0);
  const qc = useQueryClient();
  // The page on screen: a save sent for a page since left must not be shown as this one's
  const shown = useRef(pageId);
  useEffect(() => { shown.current = pageId; }, [pageId]);
  const saveM = useMutation({
    // One page's tuning saves run in the order they were made, so a reset can't be overtaken by an earlier edit
    scope: { id: `page-tuning:${pageId}` },
    mutationFn: ({ id, changes }: { id: string; changes: Changes }) => setPageTuning(id, changes),
    onSuccess: (detail, { id }) => {
      if (id === shown.current) onChanged(detail);
      else void qc.invalidateQueries({ queryKey: ["studio-page", id] });
    },
  });

  // Edits wait out SAVE_DELAY_MS together, in one instance that outlives renders. Every save goes through the latest
  // mutation and is tracked, so an action started meanwhile (Clean text, Run again) waits for it
  const save = useRef((variables: { id: string; changes: Changes }) => trackSave(saveM.mutateAsync(variables)));
  useEffect(() => {
    save.current = (variables) => trackSave(saveM.mutateAsync(variables));
  }, [saveM.mutateAsync, trackSave]);
  const [pending] = useState(() => new PendingChanges<Changes>((id, changes) => save.current({ id, changes }), SAVE_DELAY_MS));
  // An action sends what is waiting first; collapsing the panel or leaving the page sends it too, to the page it was
  // typed on, rather than dropping it
  useEffect(() => registerFlush(() => pending.flush()), [registerFlush, pending]);
  useEffect(() => () => pending.flush(), [pending]);

  const change = (key: TuningKey, value: number | undefined) => pending.change(pageId, key, value ?? null);
  /** Every knob back to its default. An edit still waiting would otherwise land after it and undo part of it. */
  const reset = () => {
    pending.discard();
    save.current({ id: pageId, changes: Object.fromEntries(TUNING_KNOBS.map((knob) => [knob.key, null])) });
  };

  return (
    <div className="pt-2 border-t border-gray-800 space-y-2">
      <button
        onClick={() => {
          // Closing sends an edit still waiting now, rather than after the controls have gone
          if (open) pending.flush();
          setOpen(!open);
        }}
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
              onClick={reset}
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
