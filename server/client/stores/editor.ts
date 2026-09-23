import { create } from "zustand";
import type { PageImage } from "../api";
import { readPanelCollapsed, savePanelCollapsed } from "../lib/editor-prefs";

/** Which of the editor's two views is showing. */
export type EditorView = "canvas" | "compare";

interface EditorState {
  /** Which page's state this is. Until it is a page's own, that page reads the defaults instead. */
  pageId: string | null;
  /**
   * Counts openings. The page id alone can't tell one visit from the next: leaving a page and coming back opens a
   * fresh editor with the same id, and work left over from the first visit would otherwise still speak for it.
   */
  session: number;
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
  /** A page opens with nothing selected and nothing rewritten; the panel stays as the person left it. */
  openPage: (pageId: string) => void;
}

/** What a page starts as, and what another page's state reads as until that page opens. */
const FRESH = { view: "canvas" as EditorView, canvasImage: "original.png" as PageImage, selectedBlock: null, imagesNonce: 0 };

/**
 * What the page editor is showing, rather than what it is showing it of (that is the page itself, from the server).
 * A store because the canvas, its toolbar, the block list and the lettering panel all read and change the same few
 * things — which block is selected above all.
 */
export const useEditorStore = create<EditorState>((set, get) => ({
  pageId: null,
  session: 0,
  ...FRESH,
  panelCollapsed: readPanelCollapsed(),

  setView: (view) => set({ view }),
  setCanvasImage: (canvasImage) => set({ canvasImage }),
  selectBlock: (selectedBlock) => set({ selectedBlock }),
  setPanelCollapsed: (panelCollapsed) => {
    savePanelCollapsed(panelCollapsed);
    set({ panelCollapsed });
  },
  imagesChanged: () => set({ imagesNonce: get().imagesNonce + 1 }),
  openPage: (pageId) => set({ pageId, session: get().session + 1, ...FRESH }),
}));

/**
 * The editor's state for one page. The store is opened for a page in a layout effect — after that page's first
 * render — so until it says it holds this page, what it holds is the page the user just left, and this reads the
 * defaults rather than the other page's view, image, selection or nonce.
 */
export function useEditorPage(pageId: string): Pick<EditorState, "view" | "canvasImage" | "selectedBlock" | "imagesNonce"> {
  const holdsThisPage = useEditorStore((state) => state.pageId === pageId);
  const view = useEditorStore((state) => state.view);
  const canvasImage = useEditorStore((state) => state.canvasImage);
  const selectedBlock = useEditorStore((state) => state.selectedBlock);
  const imagesNonce = useEditorStore((state) => state.imagesNonce);
  return holdsThisPage ? { view, canvasImage, selectedBlock, imagesNonce } : FRESH;
}
