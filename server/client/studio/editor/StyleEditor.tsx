/**
 * Lettering in the page editor: a block's style editor, the floating lettering panel, and the small fields they are
 * built from. Split out of pages/StudioPageEditor.tsx.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlignCenter, AlignLeft, AlignRight, Loader2, Trash2 } from "lucide-react";
import { updateBlock, type FontVariant, type TextAlign, type TextStyle, type StudioBlock, type StudioPageDetail } from "../../api";
import { Toggle } from "../../components/Toggle";

/**
 * Saves the latest value after `delay` ms without changes. The save is registered with `trackSave` as soon as it's
 * scheduled (not when the timer fires), so page actions such as Burn lettering or Publish wait for edits made just
 * before them. Only one save runs at a time: values changed meanwhile are coalesced into one save that starts after
 * it, so an older response can never overwrite a newer value. A save still pending when the component goes away is
 * sent right then. `onError` runs when a save fails (e.g. to reload the server's state over optimistic updates).
 */
export function useDebouncedSave<T>(
  delay: number,
  save: (value: T) => Promise<unknown>,
  trackSave: (save: Promise<unknown>) => void,
  onError?: (err: unknown) => void,
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ save, trackSave, onError });
  latest.current = { save, trackSave, onError };
  /** The value to save with the callbacks it was scheduled with, so it always goes to its original target. */
  const pending = useRef<{
    value: T;
    save: (value: T) => Promise<unknown>;
    onError?: (err: unknown) => void;
    resolve: () => void;
    reject: (err: unknown) => void;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  /** A flush was asked for while a save was running: run it when that save ends. */
  const flushAfter = useRef(false);

  const flush = useCallback(function flushPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current) {
      flushAfter.current = true;
      return;
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    inFlight.current = true;
    setSaving(true);
    next.save(next.value)
      .then(
        () => {
          setError(null);
          next.resolve();
        },
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          next.onError?.(err);
          next.reject(err);
        },
      )
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
        if (flushAfter.current) {
          flushAfter.current = false;
          flushPending();
        }
      });
  }, []);
  useEffect(() => flush, [flush]);

  const schedule = (value: T) => {
    if (pending.current) {
      pending.current.value = value;
      pending.current.save = latest.current.save;
      pending.current.onError = latest.current.onError;
    } else {
      let settle: { resolve: () => void; reject: (err: unknown) => void } = { resolve: () => {}, reject: () => {} };
      const promise = new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
      pending.current = { value, save: latest.current.save, onError: latest.current.onError, ...settle };
      latest.current.trackSave(promise);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  return { schedule, flush, saving, error };
}

/** Drops unset fields; an empty style means automatic lettering. */
export function compactStyle(style: TextStyle): TextStyle | null {
  const next = { ...style } as Record<string, unknown>;
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return Object.keys(next).length > 0 ? (next as TextStyle) : null;
}

/**
 * Lettering overrides for one block. Changes show in the canvas preview at once and are saved after a short pause
 * (page actions wait for the save); a save still pending when the panel goes away is sent right then.
 */
export function StyleEditor({ pageId, block, disabled, onChanged, trackSave, setBlockStyle, open = false }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  trackSave: (save: Promise<unknown>) => void;
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  /** Starts expanded (the floating lettering panel). */
  open?: boolean;
}) {
  /**
   * The latest style scheduled for saving: later edits build on it (not on `block.style`, which a page refresh can
   * reset before the save lands), so quick successive changes can't drop each other. Cleared once that save is done.
   */
  const draft = useRef<{ style: TextStyle | null } | null>(null);
  const qc = useQueryClient();
  const style = (draft.current ? draft.current.style ?? {} : block.style ?? {}) as TextStyle;
  const { schedule, saving, error } = useDebouncedSave<TextStyle | null>(
    400,
    (next) => updateBlock(pageId, block.id, { style: next }).then(onChanged).finally(() => {
      if (draft.current?.style === next) draft.current = null;
    }),
    trackSave,
    // The preview showed the unsaved style: go back to what the server has
    () => void qc.invalidateQueries({ queryKey: ["studio-page", pageId] }),
  );

  const change = (patch: Partial<TextStyle>) => {
    const next = compactStyle({ ...style, ...patch });
    draft.current = { style: next };
    setBlockStyle(block.id, next);
    schedule(next);
  };

  const custom = block.style !== null && Object.keys(style).length > 0;
  const previewable = !!style.box || !!block.area || block.kind === "sfx";

  return (
    <details open={open || undefined} className="rounded-md border border-gray-800 bg-gray-950/40">
      <summary className="cursor-pointer select-none px-2 py-1 text-xs text-gray-400 flex items-center gap-2">
        Lettering
        {custom && <span className="text-violet-300">custom</span>}
        {!previewable && <span className="text-gray-600">· placing…</span>}
        {saving && <Loader2 size={11} className="animate-spin" />}
      </summary>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-2 pb-2 pt-1 text-xs text-gray-400">
        <label className="flex items-center justify-between gap-2">
          Font
          <select
            value={style.font ?? "bold"}
            disabled={disabled}
            onChange={(e) => change({ font: e.target.value === "bold" ? undefined : (e.target.value as FontVariant) })}
            className="bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-gray-200"
          >
            <option value="regular">Regular</option>
            <option value="bold">Bold</option>
            <option value="italic">Italic</option>
          </select>
        </label>
        <NumberField label="Size" value={style.font_size} min={6} max={400} step={1} placeholder="auto" disabled={disabled}
          onChange={(v) => change({ font_size: v === undefined ? undefined : Math.round(v) })} />
        <ColorField label="Fill" value={style.fill} fallback="#000000" disabled={disabled} onChange={(v) => change({ fill: v })} />
        <ColorField label="Outline" value={style.stroke} fallback="#ffffff" disabled={disabled} onChange={(v) => change({ stroke: v })} />
        <NumberField label="Outline px" value={style.stroke_width} min={0} max={60} step={0.5} placeholder="auto" disabled={disabled}
          onChange={(v) => change({ stroke_width: v })} />
        <NumberField label="Line height" value={style.line_height} min={0.6} max={3} step={0.05} placeholder="1.1" disabled={disabled}
          onChange={(v) => change({ line_height: v })} />
        <div className="flex items-center justify-between gap-2">
          Align
          <span className="flex rounded border border-gray-700 overflow-hidden" role="group" aria-label="Alignment">
            {([["left", <AlignLeft size={12} />], ["center", <AlignCenter size={12} />], ["right", <AlignRight size={12} />]] as [TextAlign, ReactNode][]).map(([value, icon]) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-pressed={(style.align ?? "center") === value}
                aria-label={`Align ${value}`}
                onClick={() => change({ align: value === "center" ? undefined : value })}
                className={`px-1.5 py-1 ${(style.align ?? "center") === value ? "bg-gray-700 text-gray-50" : "hover:bg-gray-800"}`}
              >
                {icon}
              </button>
            ))}
          </span>
        </div>
        <NumberField label="Rotation °" value={style.rotation} min={-180} max={180} step={1} placeholder="0" disabled={disabled}
          onChange={(v) => change({ rotation: v === 0 ? undefined : v })} />
        <Toggle
          size="sm"
          checked={style.uppercase ?? true}
          disabled={disabled}
          onChange={(on) => change({ uppercase: on ? undefined : false })}
          className="gap-1.5"
        >
          Capitals
        </Toggle>
        <div className="flex items-center justify-end">
          {style.box || style.offset ? (
            <button type="button" disabled={disabled} onClick={() => change({ box: undefined, offset: undefined })} className="text-violet-300 hover:text-violet-200 disabled:opacity-40">
              Back to bubble
            </button>
          ) : (
            <span className="text-gray-600" title="In Lettering mode (L), drag the lettering to move it or its handles to resize and rotate">In bubble</span>
          )}
        </div>
        <button
          type="button"
          disabled={disabled || !custom}
          onClick={() => change({ font: undefined, font_size: undefined, fill: undefined, stroke: undefined, stroke_width: undefined, align: undefined, line_height: undefined, uppercase: undefined, rotation: undefined, box: undefined, offset: undefined })}
          className="col-span-2 justify-self-start text-gray-400 hover:text-gray-50 disabled:opacity-40"
        >
          Reset to automatic
        </button>
      </div>
      {error && <p className="px-2 pb-2 text-xs text-red-400">{error}</p>}
    </details>
  );
}

/**
 * The floating editor next to selected lettering (Lettering mode): its text, drawn live on the page as you type and
 * saved after a short pause, and its style.
 */
export function LetteringPanel({ pageId, block, disabled, onChanged, trackSave, setBlockStyle, setBlockText, onDelete }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  trackSave: (save: Promise<unknown>) => void;
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  setBlockText: (blockId: number, text: string) => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const saved = block.translated_text ?? "";
  const [text, setText] = useState(saved);
  const editing = useRef(false);
  // Follow the server value unless the user is typing here
  useEffect(() => {
    if (!editing.current) setText(saved);
  }, [saved]);
  const { schedule: scheduleText, flush: flushText, saving, error } = useDebouncedSave<string>(
    600,
    (next) => updateBlock(pageId, block.id, { translated_text: next }).then(onChanged),
    trackSave,
    // The preview showed the unsaved text: go back to what the server has
    () => void qc.invalidateQueries({ queryKey: ["studio-page", pageId] }),
  );

  const isSfx = block.kind === "sfx";
  return (
    <div className="p-2.5 space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`font-semibold ${isSfx ? "text-orange-400" : "text-sky-400"}`}>#{block.id}</span>
        <span className="text-gray-400">{isSfx ? "Sound effect lettering" : "Text lettering"}</span>
        {saving && <Loader2 size={11} className="animate-spin text-gray-500" />}
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          title="Delete this region (Ctrl+Z undoes it)"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-gray-400 hover:bg-red-900/50 hover:text-red-200 disabled:opacity-40"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
      <textarea
        data-lettering-text
        value={text}
        disabled={disabled}
        rows={3}
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
          flushText();
        }}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          setBlockText(block.id, next);
          scheduleText(next);
        }}
        placeholder={isSfx ? "New lettering for this sound effect" : "Translation"}
        title="Enter starts a new line in the lettering; otherwise the text wraps to the bubble"
        className="w-full resize-y bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-violet-500"
      />
      {error && <p className="text-red-400">{error}</p>}
      {text.trim() === "" && <p className="text-gray-500">Type to letter this {isSfx ? "sound effect" : "block"}.</p>}
      <StyleEditor pageId={pageId} block={block} disabled={disabled} onChanged={onChanged} trackSave={trackSave} setBlockStyle={setBlockStyle} open />
    </div>
  );
}

/** A number input that only reports values inside [min, max]; empty means unset. Shows the saved value on blur. */
export function NumberField({ label, value, min, max, step, placeholder, disabled, onChange }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  placeholder: string;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const shown = value === undefined ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next === "") return onChange(undefined);
          const n = Number(next);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setText(shown)}
        className="w-16 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-right text-gray-200 tabular-nums"
      />
    </label>
  );
}

/** A colour that is automatic (by background brightness) until its box is ticked. */
export function ColorField({ label, value, fallback, disabled, onChange }: {
  label: string;
  value: string | undefined;
  fallback: string;
  disabled: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Toggle
        size="sm"
        checked={value !== undefined}
        disabled={disabled}
        onChange={(on) => onChange(on ? fallback : undefined)}
        title="On for a fixed colour; off picks black or white by the background"
        className="gap-1.5"
      >
        {label}
      </Toggle>
      <input
        type="color"
        aria-label={`${label} colour`}
        value={value ?? fallback}
        disabled={disabled || value === undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-8 bg-transparent disabled:opacity-40"
      />
    </div>
  );
}

export function IconButton({ title, disabled, onClick, children }: { title: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1 rounded text-gray-400 hover:text-gray-50 hover:bg-gray-800 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
