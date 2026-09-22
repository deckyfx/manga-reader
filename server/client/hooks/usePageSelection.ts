import { useCallback, useState } from "react";

/** Picking pages in a grid: on or off, and which are picked. Leaving selection mode forgets the picks. */
export function usePageSelection() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const start = useCallback(() => setSelecting(true), []);
  const stop = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const selectAll = useCallback((ids: readonly string[]) => setSelected(new Set(ids)), []);

  return { selecting, selected, toggle, start, stop, selectAll };
}
