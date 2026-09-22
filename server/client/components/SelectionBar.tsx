import { Archive, CheckSquare, X } from "lucide-react";

interface SelectionBarProps {
  /** How many are picked, out of how many shown. */
  count: number;
  total: number;
  onSelectAll: () => void;
  onFinalize: () => void;
  onCancel: () => void;
}

/** What can be done with the picked pages, shown above a grid in selection mode. */
export function SelectionBar({ count, total, onSelectAll, onFinalize, onCancel }: SelectionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-indigo-900/60 bg-indigo-950/40 px-4 py-2 text-sm">
      <span className="text-gray-300">
        {count} of {total} picked
      </span>
      <button
        onClick={onSelectAll}
        disabled={count === total}
        className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
      >
        <CheckSquare size={13} /> All
      </button>
      <button
        onClick={onFinalize}
        disabled={count === 0}
        className="ml-auto flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40"
      >
        <Archive size={14} /> Finalize…
      </button>
      <button onClick={onCancel} aria-label="Stop picking pages" className="rounded-lg p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-50">
        <X size={16} />
      </button>
    </div>
  );
}
