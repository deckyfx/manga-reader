const STATUS_CLASSES: Record<string, string> = {
  done: "bg-emerald-900/60 text-emerald-300",
  fresh: "bg-emerald-900/60 text-emerald-300",
  error: "bg-red-900/60 text-red-300",
  running: "bg-yellow-900/60 text-yellow-300",
  stale: "bg-amber-900/60 text-amber-300",
  queued: "bg-gray-800 text-gray-400",
};

/** Small coloured pill for page and stage statuses. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const cls = STATUS_CLASSES[status] ?? "bg-gray-800 text-gray-400";
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cls}`}>{label ?? status}</span>;
}
