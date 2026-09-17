import { useEffect, useState } from "react";
import { fontUrl, type StudioPageDetail, type TextPatch, type TextStyle } from "../../api";
import { areaFromStored, FONT_VARIANTS, rectArea, Typesetter, typesetPage, type TypesetEntry } from "../../../src/shared/typeset";

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

/** One block's previewed lettering. */
export interface TextPreview {
  id: number;
  patch: TextPatch;
  fits: boolean;
}

/**
 * The page's lettering as the burn would draw it, from the same shared code: each block's stored text area (or its
 * explicit box, or a sound effect's own box) with its style. A text block that has never been rendered, or was moved
 * since, has no stored area and isn't previewed until the next burn.
 */
export function buildTextPreview(detail: StudioPageDetail, typesetter: Typesetter): TextPreview[] {
  const entries: TypesetEntry[] = detail.blocks.flatMap((block) => {
    if ((block.kind !== "text" && block.kind !== "sfx") || !block.translated_text?.trim()) return [];
    const style = (block.style ?? {}) as TextStyle;
    const area = style.box
      ? rectArea(style.box, block.area?.dark ?? false)
      : block.area
        ? areaFromStored(block.area)
        : block.kind === "sfx"
          ? rectArea(block, false)
          : null;
    return area ? [{ id: block.id, text: block.translated_text, area, style }] : [];
  });
  const { blocks } = typesetPage(typesetter, entries, { width: detail.page.width, height: detail.page.height });
  return blocks.flatMap((b) => (b.patch ? [{ id: b.id, patch: b.patch, fits: b.layout.fits }] : []));
}
