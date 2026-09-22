/**
 * The page editor's block list: a text block's editor, a sound effect's row, whether each is cleaned, and what each
 * is waiting for. Split out of pages/StudioPageEditor.tsx.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Languages, Loader2, ScanText, Trash2, TriangleAlert } from "lucide-react";
import { runStage, updateBlock, type TextStyle, type StudioBlock, type StudioPageDetail } from "../../api";
import { Toggle } from "../../components/Toggle";
import { StyleEditor, IconButton } from "./StyleEditor";

/** A textarea that saves when it loses focus, and follows the server value when that changes. */
export function useSavedText(saved: string) {
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  return { text, setText, dirty: text !== saved };
}

/** One text block: editable source text and translation, plus per-block OCR and translation re-runs. */
export function BlockEditor({ pageId, block, disabled, onChanged, trackSave, afterSaves, queued, selected, onSelect, setBlockStyle, onDelete }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  /** Registers an in-flight save so page actions wait for it. */
  trackSave: (save: Promise<unknown>) => void;
  /** Runs the action once every pending save has succeeded; a second call with the same key while queued is ignored. */
  afterSaves: (key: string, action: () => void) => void;
  /** Keys of actions currently waiting on saves. */
  queued: ReadonlySet<string>;
  /** Selected on the canvas: highlighted and scrolled into view. */
  selected: boolean;
  onSelect: () => void;
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  onDelete: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const ocrKey = `block:${block.id}:ocr`;
  const translateKey = `block:${block.id}:translate`;
  const source = useSavedText(block.source_text ?? "");
  const translation = useSavedText(block.translated_text ?? "");
  const saveM = useMutation({
    mutationFn: (text: { source_text?: string; translated_text?: string }) => updateBlock(pageId, block.id, text),
    onSuccess: onChanged,
  });
  const runM = useMutation({
    mutationFn: (stage: "ocr" | "translate") => runStage(pageId, stage, [block.id]),
    onSuccess: onChanged,
  });
  const locked = disabled || runM.isPending;
  const error = saveM.error ?? runM.error;

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      className={`bg-gray-900 border rounded-lg p-2.5 space-y-1.5 transition-colors ${selected ? "border-sky-400" : "border-gray-800"}`}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-sky-400">#{block.id}</span>
        <BlockNeeds block={block} />
        {block.render && !block.render.fits && (
          <span className="flex items-center gap-1 text-amber-400" title="The text did not fit its area">
            <TriangleAlert size={12} /> overflow
          </span>
        )}
        {block.render && <span className="text-gray-500">{block.render.font_size}px</span>}
        {(saveM.isPending || runM.isPending) && <Loader2 size={12} className="animate-spin text-gray-500" />}
        {(source.dirty || translation.dirty) && !saveM.isPending && <span className="text-amber-400">unsaved</span>}
        <IncludeToggle pageId={pageId} block={block} disabled={locked} onChanged={onChanged} trackSave={trackSave} title="Remove this block's lettering when the text is cleaned" />
        <span className="ml-auto flex gap-1">
          <IconButton title="Read the text again (OCR)" disabled={locked || queued.has(ocrKey)} onClick={() => afterSaves(ocrKey, () => runM.mutate("ocr"))}>
            <ScanText size={13} />
          </IconButton>
          <IconButton title="Translate again" disabled={locked || queued.has(translateKey) || !source.text.trim()} onClick={() => afterSaves(translateKey, () => runM.mutate("translate"))}>
            <Languages size={13} />
          </IconButton>
          <IconButton title="Delete this region" disabled={locked} onClick={onDelete}>
            <Trash2 size={13} />
          </IconButton>
        </span>
      </div>
      <textarea
        value={source.text}
        disabled={locked}
        onChange={(e) => source.setText(e.target.value)}
        onBlur={() => source.dirty && trackSave(saveM.mutateAsync({ source_text: source.text }))}
        rows={Math.min(4, Math.max(1, Math.ceil(source.text.length / 20)))}
        placeholder="Source text"
        className="w-full resize-y bg-gray-950/60 border border-gray-800 rounded-md px-2 py-1 text-sm text-gray-400 focus:outline-none focus:border-indigo-500"
      />
      <textarea
        value={translation.text}
        disabled={locked}
        onChange={(e) => translation.setText(e.target.value)}
        onBlur={() => translation.dirty && trackSave(saveM.mutateAsync({ translated_text: translation.text }))}
        rows={Math.min(6, Math.max(2, Math.ceil(translation.text.length / 40)))}
        placeholder="Translation"
        title="Enter starts a new line in the lettering; otherwise the text wraps to the bubble"
        className="w-full resize-y bg-gray-950 border border-gray-700 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
      />
      <StyleEditor pageId={pageId} block={block} disabled={locked} onChanged={onChanged} trackSave={trackSave} setBlockStyle={setBlockStyle} />
      {error && <p className="text-xs text-red-400">{error.message}</p>}
    </div>
  );
}

/** Whether the clean pass removes a block; saved right away (the server marks the clean stages stale). */
export function IncludeToggle({ pageId, block, disabled, onChanged, trackSave, title }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  /** Registers the save so Clean text / Clean SFX wait for it and clean with the new setting. */
  trackSave: (save: Promise<unknown>) => void;
  title: string;
}) {
  const includeM = useMutation({
    mutationFn: (include: boolean) => updateBlock(pageId, block.id, { include }),
    onSuccess: onChanged,
  });
  const checked = includeM.isPending && includeM.variables !== undefined ? includeM.variables : block.include;
  return (
    <Toggle
      size="sm"
      checked={checked}
      disabled={disabled || includeM.isPending}
      onChange={(include) => trackSave(includeM.mutateAsync(include))}
      title={includeM.error ? includeM.error.message : title}
      className="gap-1 text-gray-400"
    >
      <span className={includeM.error ? "text-red-400" : undefined}>clean</span>
    </Toggle>
  );
}

/**
 * What this block is waiting for since it changed: a new translation, or just burning again. The page's stage tags
 * say a stage is out of date; this says which blocks made it so.
 */
export function BlockNeeds({ block }: { block: StudioBlock }) {
  if (block.needs_translate) {
    return <span className="rounded-full bg-amber-900/50 px-1.5 text-[10px] text-amber-300" title="Its text changed since it was translated">translate</span>;
  }
  if (block.needs_render) {
    return <span className="rounded-full bg-amber-900/50 px-1.5 text-[10px] text-amber-300" title="Changed since the page was last burned">re-burn</span>;
  }
  return null;
}

/** One sound-effect region: selectable, with its include-in-cleaning toggle and optional new lettering. */
export function SfxBlockRow({ pageId, block, disabled, onChanged, trackSave, selected, onSelect, setBlockStyle, onDelete }: {
  pageId: string;
  block: StudioBlock;
  disabled: boolean;
  onChanged: (detail: StudioPageDetail) => void;
  trackSave: (save: Promise<unknown>) => void;
  selected: boolean;
  onSelect: () => void;
  setBlockStyle: (blockId: number, style: TextStyle | null) => void;
  onDelete: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const lettering = useSavedText(block.translated_text ?? "");
  const saveM = useMutation({
    mutationFn: (text: string) => updateBlock(pageId, block.id, { translated_text: text }),
    onSuccess: onChanged,
  });
  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      className={`bg-gray-900 border rounded-lg px-2.5 py-1.5 text-xs space-y-1.5 cursor-pointer transition-colors ${selected ? "border-orange-400" : "border-gray-800"}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-orange-400">#{block.id}</span>
        <BlockNeeds block={block} />
        <span className="text-gray-500 tabular-nums">{block.w}×{block.h}</span>
        {saveM.isPending && <Loader2 size={12} className="animate-spin text-gray-500" />}
        <span className="ml-auto">
          <IncludeToggle pageId={pageId} block={block} disabled={disabled} onChanged={onChanged} trackSave={trackSave} title="Remove this sound effect when SFX are cleaned" />
        </span>
        <IconButton title="Delete this region" disabled={disabled} onClick={onDelete}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      <textarea
        value={lettering.text}
        disabled={disabled}
        onChange={(e) => lettering.setText(e.target.value)}
        onBlur={() => lettering.dirty && trackSave(saveM.mutateAsync(lettering.text))}
        rows={1}
        placeholder="New lettering (optional)"
        className="w-full resize-y bg-gray-950 border border-gray-800 rounded-md px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
      />
      {saveM.error && <p className="text-red-400">{saveM.error.message}</p>}
      {lettering.text.trim() !== "" && (
        <StyleEditor pageId={pageId} block={block} disabled={disabled} onChanged={onChanged} trackSave={trackSave} setBlockStyle={setBlockStyle} />
      )}
    </div>
  );
}
