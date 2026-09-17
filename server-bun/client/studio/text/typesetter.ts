import { useEffect, useState } from "react";
import { fontUrl, type LetteringPaths, type StudioPageDetail, type TextStyle } from "../../api";
import { areaFromStored, FONT_VARIANTS, rectArea, shiftArea, Typesetter, typesetBlock, typesetPage, type Box, type TypesetEntry } from "../../../src/shared/typeset";

let shared: Promise<Typesetter> | null = null;

/** The shared typesetter with the fonts the server letters with, loaded once per tab (retried after a failure). */
export function loadTypesetter(): Promise<Typesetter> {
  shared ??= Promise.all(
    FONT_VARIANTS.map(async (variant) => {
      const res = await fetch(fontUrl(variant));
      if (!res.ok) throw new Error(`font ${variant}: HTTP ${res.status}`);
      return res.arrayBuffer();
    }),
  ).then(([regular, bold, italic]) => Typesetter.fromBuffers({ regular, bold, italic }));
  shared.catch(() => {
    shared = null;
  });
  return shared;
}

/** The typesetter once its fonts have loaded (null until then), plus a load error to show. */
export function useTypesetter(): { typesetter: Typesetter | null; error: string | null } {
  const [state, setState] = useState<{ typesetter: Typesetter | null; error: string | null }>({ typesetter: null, error: null });
  useEffect(() => {
    let cancelled = false;
    loadTypesetter().then(
      (typesetter) => !cancelled && setState({ typesetter, error: null }),
      (err: unknown) => !cancelled && setState({ typesetter: null, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** One block's lettering as it floats on the canvas. */
export interface LetteringItem {
  id: number;
  kind: "text" | "sfx";
  /** Where the lettering sits (page pixels); it rotates around the box centre. */
  box: Box;
  rotation: number;
  /** The found area before any offset, so a move can be stored as an offset that keeps the bubble shape. */
  baseBox: Box;
  /** The block has an explicit text box (moves and resizes change the box). */
  hasExplicitBox: boolean;
  paths: LetteringPaths | null;
  fits: boolean;
  /** False until the server has found this block's text area; until then it's previewed in its region box. */
  placed: boolean;
}

export interface LetteringPlan {
  items: LetteringItem[];
  /** The shared automatic size, reused when one block is re-laid out live. */
  pageFontSize: number;
}

/**
 * The page's lettering as the burn would draw it, from the same shared code: each block's stored text area (moved by
 * its offset) or its explicit box, with its style. A block not placed yet is laid out in its own region box.
 */
export function buildLettering(detail: StudioPageDetail, typesetter: Typesetter): LetteringPlan {
  const page = { width: detail.page.width, height: detail.page.height };
  const prepared = detail.blocks.flatMap((block) => {
    if ((block.kind !== "text" && block.kind !== "sfx") || !block.translated_text?.trim()) return [];
    const style = (block.style ?? {}) as TextStyle;
    const stored = block.area;
    const baseBox = stored ? stored.bound : { x: block.x, y: block.y, w: block.w, h: block.h };
    const dark = stored?.dark ?? false;
    const area = style.box
      ? rectArea(style.box, dark)
      : shiftArea(stored ? areaFromStored(stored) : rectArea(baseBox, dark), style.offset);
    return [{ block, kind: block.kind as "text" | "sfx", style, area, baseBox, placed: !!stored || !!style.box }];
  });
  const entries: TypesetEntry[] = prepared.map((p) => ({ id: p.block.id, text: p.block.translated_text ?? "", area: p.area, style: p.style }));
  const result = typesetPage(typesetter, entries, page);
  const items = prepared.map((p): LetteringItem => {
    const typeset = result.blocks.find((b) => b.id === p.block.id);
    return {
      id: p.block.id,
      kind: p.kind,
      box: p.area.bound,
      rotation: p.style.rotation ?? 0,
      baseBox: p.baseBox,
      hasExplicitBox: !!p.style.box,
      paths: typeset?.paths ?? null,
      fits: typeset?.layout.fits ?? false,
      placed: p.placed,
    };
  });
  return { items, pageFontSize: result.pageFontSize };
}

/** One block laid out again in a new text box, for live re-wrapping while its box is resized. */
export function relayoutBlock(typesetter: Typesetter, detail: StudioPageDetail, id: number, box: Box, pageFontSize: number): LetteringPaths | null {
  const block = detail.blocks.find((b) => b.id === id);
  if (!block?.translated_text?.trim()) return null;
  const style = { ...((block.style ?? {}) as TextStyle), box };
  delete style.offset;
  const page = { width: detail.page.width, height: detail.page.height };
  return typesetBlock(typesetter, { id, text: block.translated_text, area: rectArea(box, block.area?.dark ?? false), style }, page, pageFontSize)?.paths ?? null;
}
