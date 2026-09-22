/**
 * What the page editor hands the canvas, and what it can ask of it. Split out of PageCanvas.tsx.
 */
import type { ReactNode, Ref } from "react";
import type { LetteringPaths, StudioBlock, StudioPageDetail, TextStyle } from "../../api";
import type { LetteringItem } from "../text/typesetter";
import type { Toolset } from "../toolset";
import type { EditMode } from "./config";
import type { PageSize } from "./geometry";

/** What the page editor can ask the canvas to do. */
export interface PageCanvasHandle {
  /** Deletes a region through the canvas history, so it can be undone. */
  deleteBlock: (id: number) => void;
}

export interface PageCanvasProps {
  ref?: Ref<PageCanvasHandle>;
  pageId: string;
  /** Background image (a stage image of the page). */
  imageUrl: string;
  page: PageSize;
  blocks: StudioBlock[];
  disabled: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Called with the page detail returned by each successful change. */
  onDetail: (detail: StudioPageDetail) => void;
  /** Re-fetch the page after a failed change, so the canvas matches the server again. */
  onReload: () => void;
  /** Extra controls at the start of the toolbar (e.g. the background image picker). */
  toolbarStart?: ReactNode;
  /** A cleaned page image was rewritten (e.g. re-cleaning an area): reload the stage images. */
  onImagesChanged: () => void;
  /** Lettering laid out by the shared typesetter, as the burn would place it. */
  lettering: LetteringItem[];
  /** In Regions mode the lettering shows only over a cleaned page (not over the original or the burned result). */
  textPreviewAvailable: boolean;
  /** Shows a style change right away, before the server has saved it. */
  onStylePreview: (id: number, style: TextStyle | null) => void;
  /** Lays one block out again in a new box, for live re-wrapping while it's resized. */
  relayout: (id: number, box: { x: number; y: number; w: number; h: number }) => LetteringPaths | null;
  onModeChange?: (mode: EditMode) => void;
  /** Floating editor shown next to the selected block in Lettering mode. */
  renderLetteringPanel?: (id: number) => ReactNode;
  /** The toolset the previous page was left with; read once, when the canvas opens. */
  initialToolset?: Toolset;
  /** Told whenever the toolset changes, so the next page can start from it. */
  onToolsetChange?: (patch: Toolset) => void;
}
