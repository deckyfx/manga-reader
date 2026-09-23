import { useEffect } from "react";
import { create } from "zustand";

interface SelectionState {
  /** Which grid is picking: "studio", `workspace:<id>`, … Null when nothing is. */
  scope: string | null;
  selected: ReadonlySet<string>;
  start: (scope: string) => void;
  stop: () => void;
  toggle: (id: string) => void;
  selectAll: (ids: readonly string[]) => void;
}

/**
 * Picking pages in a grid, for finalizing several at once. One grid picks at a time — the scope says which — so
 * leaving a page, or starting elsewhere, drops what was picked rather than carrying it somewhere it doesn't belong.
 */
export const useSelectionStore = create<SelectionState>((set) => ({
  scope: null,
  selected: new Set(),
  start: (scope) => set({ scope, selected: new Set() }),
  stop: () => set({ scope: null, selected: new Set() }),
  toggle: (id) => set((state) => {
    const next = new Set(state.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selected: next };
  }),
  selectAll: (ids) => set({ selected: new Set(ids) }),
}));

/** The picking state of one grid: whether it is picking, and what it has picked. */
export function usePageSelection(scope: string) {
  const picking = useSelectionStore((state) => state.scope === scope);
  // Leaving the grid really does drop what was picked: without this, coming back to Studio from a workspace would
  // find the old selection waiting, ready to be finalized from a page the user had moved on from
  useEffect(() => () => {
    const state = useSelectionStore.getState();
    if (state.scope === scope) state.stop();
  }, [scope]);
  const selected = useSelectionStore((state) => state.selected);
  const { start, stop, toggle, selectAll } = useSelectionStore.getState();
  return {
    selecting: picking,
    selected: picking ? selected : (EMPTY as ReadonlySet<string>),
    start: () => start(scope),
    stop,
    toggle,
    selectAll,
  };
}

const EMPTY: ReadonlySet<string> = new Set();
