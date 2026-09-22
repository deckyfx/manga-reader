/**
 * The page editor's publish history: earlier published versions, and rolling back to one. Split out of
 * pages/StudioPageEditor.tsx.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";
import { historyImageUrl, listHistory, rollbackPage } from "../../api";

/** Earlier publishes with thumbnails; restoring one publishes it again as a new revision. */
export function HistoryPanel({ pageId, currentRevision, disabled, onRolledBack }: {
  pageId: string;
  currentRevision: number;
  disabled: boolean;
  onRolledBack: (result: { revision: number; notified: number }) => void;
}) {
  const historyQ = useQuery({ queryKey: ["studio-history", pageId], queryFn: () => listHistory(pageId) });
  const rollbackM = useMutation({ mutationFn: (revision: number) => rollbackPage(pageId, revision), onSuccess: onRolledBack });
  const entries = historyQ.data ?? [];

  return (
    <div className="pt-2 border-t border-gray-800 space-y-2">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <History size={13} /> Published revisions
      </div>
      {entries.length === 0 && <p className="text-xs text-gray-600">Nothing published yet.</p>}
      {rollbackM.error && <p className="text-xs text-red-400">{rollbackM.error.message}</p>}
      <div className="grid grid-cols-3 gap-2">
        {entries.map((entry) => (
          <div key={entry.revision} className="flex flex-col gap-1">
            <a href={historyImageUrl(pageId, entry.revision)} target="_blank" rel="noreferrer" className="block aspect-2/3 bg-gray-950 rounded overflow-hidden border border-gray-800 hover:border-indigo-500">
              <img src={historyImageUrl(pageId, entry.revision)} alt={`Revision ${entry.revision}`} loading="lazy" className="w-full h-full object-contain" />
            </a>
            <div className="flex items-center justify-between text-xs">
              <span className={entry.revision === currentRevision ? "text-emerald-400" : "text-gray-500"} title={entry.published_at}>
                rev {entry.revision}
              </span>
              {entry.revision !== currentRevision && (
                <button
                  title="Publish this revision again"
                  disabled={disabled || rollbackM.isPending}
                  onClick={() => rollbackM.mutate(entry.revision)}
                  className="text-gray-400 hover:text-gray-50 disabled:opacity-40"
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
