import { create } from "zustand";
import type { PageImage } from "../api";
import { readPanelCollapsed, savePanelCollapsed } from "../lib/editor-prefs";

/** Which of the editor's two views is showing. */
export type EditorView = "canvas" | "compare";

interface EditorState {
  view: EditorView;
  /** The stage image the canvas draws on. */
  canvasImage: PageImage;
  /** The block being edited, shared by the canvas, the block list and the lettering panel. */
  selectedBlock: number | null;
  /** The side panel is collapsed; remembered per browser, since it is a habit. */
  panelCollapsed: boolean;
  /** Bumped when a cleaned image is rewritten, so image addresses change and the browser loads the new file. */
  imagesNonce: number;

  setView: (view: EditorView) => void;
  setCanvasImage: (image: PageImage) => void;
  selectBlock: (id: number | null) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  imagesChanged: () => void;
  /** A page opens with nothing selected and nothing rewritten; the view and the panel are the person's habits. */
  openPage: () => void;
}

/**
 * What the page editor is showing, rather than what it is showing it of (that is the page itself, from the server).
 * A store because the canvas, its toolbar, the block list and the lettering panel all read and change the same few
 * things — which block is selected above all.
 */
export const useEditorStore = create<EditorState>((set, get) => ({
  view: "canvas",
  canvasImage: "original.png",
  selectedBlock: null,
  panelCollapsed: readPanelCollapsed(),
  imagesNonce: 0,

  setView: (view) => set({ view }),
  setCanvasImage: (canvasImage) => set({ canvasImage }),
  selectBlock: (selectedBlock) => set({ selectedBlock }),
  setPanelCollapsed: (panelCollapsed) => {
    savePanelCollapsed(panelCollapsed);
    set({ panelCollapsed });
  },
  imagesChanged: () => set({ imagesNonce: get().imagesNonce + 1 }),
  openPage: () => set({ view: "canvas", canvasImage: "original.png", selectedBlock: null, imagesNonce: 0 }),
}));
