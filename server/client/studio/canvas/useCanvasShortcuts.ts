/**
 * The page canvas's keyboard: tool keys, undo / redo, delete, polygon finish / cancel, fit and zoom, the brush keys,
 * and Space to pan. Split out of PageCanvas.tsx; registered once per history, reading the latest state through `live`.
 */
import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { Canvas } from "fabric";
import type { MaskLayerName } from "../../api";
import { isTyping, MAX_BRUSH, MIN_BRUSH, type CanvasActions, type EditMode, type Tool } from "./config";
import type { CommandHistory } from "./history";

interface ShortcutDeps {
  enqueue: (task: () => Promise<void>) => void;
  history: CommandHistory;
  canvasRef: RefObject<Canvas | null>;
  /** Whether Space is held (panning). */
  spaceRef: MutableRefObject<boolean>;
  actionsRef: RefObject<CanvasActions | null>;
  /** The canvas's latest props and state, read when a key is pressed. */
  live: RefObject<{ mode: EditMode; tool: Tool; selectedId: number | null; onSelect: (id: number | null) => void }>;
  setMode: Dispatch<SetStateAction<EditMode>>;
  setTool: Dispatch<SetStateAction<Tool>>;
  setBrushLayer: Dispatch<SetStateAction<MaskLayerName>>;
  setBrushSize: Dispatch<SetStateAction<number>>;
  setShowMask: Dispatch<SetStateAction<boolean>>;
  /** Puts the keyboard in the floating panel's lettering text field. */
  focusLetteringText: () => void;
}

export function useCanvasShortcuts({
  enqueue, history, canvasRef, spaceRef, actionsRef, live, setMode, setTool, setBrushLayer, setBrushSize, setShowMask, focusLetteringText,
}: ShortcutDeps): void {
  useEffect(() => {
    const undo = () => enqueue(() => history.undo());
    const redo = () => enqueue(() => history.redo());
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const canvas = canvasRef.current;
      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceRef.current && canvas) {
          spaceRef.current = true;
          canvas.skipTargetFind = true;
          canvas.setCursor("grab");
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      // Region tool keys switch back to Regions mode
      const pickTool = (next: Tool) => {
        setMode("regions");
        setTool(next);
      };
      if (key === "v") pickTool("select");
      else if (key === "r") pickTool("rect");
      else if (key === "e") pickTool("ellipse");
      else if (key === "p") pickTool("polygon");
      else if (key === "b") pickTool("brush");
      else if (key === "l") setMode((current) => (current === "lettering" ? "regions" : "lettering"));
      else if (key === "enter" && live.current.mode === "lettering" && live.current.selectedId !== null) {
        e.preventDefault();
        focusLetteringText();
      }
      else if (key === "x") setBrushLayer((layer) => (layer === "add" ? "erase" : "add"));
      else if (key === "[") setBrushSize((size) => Math.max(MIN_BRUSH, Math.round(size / 1.25)));
      else if (key === "]") setBrushSize((size) => Math.min(MAX_BRUSH, Math.round(size * 1.25)));
      else if (key === "m") setShowMask((shown) => !shown);
      else if (key === "enter") actionsRef.current?.finishPolygon();
      else if (key === "escape") {
        actionsRef.current?.cancelDrawing();
        live.current.onSelect(null);
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        actionsRef.current?.deleteSelected();
      } else if (key === "f" || key === "0") actionsRef.current?.fit();
      else if (key === "+" || key === "=") actionsRef.current?.zoomBy(1.2);
      else if (key === "-") actionsRef.current?.zoomBy(1 / 1.2);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !spaceRef.current) return;
      spaceRef.current = false;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.skipTargetFind = live.current.mode === "regions" && live.current.tool === "brush";
        canvas.setCursor(live.current.mode === "regions" && live.current.tool !== "select" ? "crosshair" : "default");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enqueue, history]);
}
