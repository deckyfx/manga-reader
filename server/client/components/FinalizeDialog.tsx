import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { finalizePages, type FinalizeReport } from "../api";
import { bytes } from "../lib/format";
import { Modal } from "./Modal";
import { Toggle } from "./Toggle";

interface FinalizeDialogProps {
  /** The pages to finalize: one from the editor, several from a list. */
  pageIds: string[];
  /** Only deleting the original is left to do (the page is already finalized with it kept). */
  onlyRaw?: boolean;
  onClose: () => void;
  onDone: (report: FinalizeReport) => void;
}

/**
 * Asks before finalizing, showing what will go and the space it frees — a dry run of exactly what the button then
 * does, taken again whenever "delete the original" changes. Pages that can't be finalized say why and are left alone.
 */
export function FinalizeDialog({ pageIds, onlyRaw = false, onClose, onDone }: FinalizeDialogProps) {
  const qc = useQueryClient();
  const [deleteRaw, setDeleteRaw] = useState(onlyRaw);
  const [showFiles, setShowFiles] = useState(false);

  const planQ = useQuery({
    queryKey: ["finalize-plan", pageIds, deleteRaw],
    queryFn: () => finalizePages(pageIds, { delete_raw: deleteRaw, dry_run: true }),
    staleTime: 0,
    gcTime: 0,
  });
  const finalizeM = useMutation({
    mutationFn: () => finalizePages(pageIds, { delete_raw: deleteRaw }),
    onSuccess: (report) => {
      void qc.invalidateQueries({ queryKey: ["studio-pages"] });
      void qc.invalidateQueries({ queryKey: ["workspace"] });
      void qc.invalidateQueries({ queryKey: ["workspaces"] });
      for (const id of pageIds) void qc.invalidateQueries({ queryKey: ["studio-page", id] });
      onDone(report);
    },
  });

  const plan = planQ.data;
  const ready = plan?.pages.filter((page) => page.ok) ?? [];
  const refused = plan?.pages.filter((page) => !page.ok) ?? [];
  const files = ready.flatMap((page) => page.files.map((file) => (pageIds.length > 1 ? `${page.id.slice(-8)}/${file}` : file)));

  return (
    <Modal
      title={onlyRaw ? "Delete the original too?" : pageIds.length === 1 ? "Finalize this page?" : `Finalize ${pageIds.length} pages?`}
      onClose={onClose}
      footer={
        <>
          {finalizeM.error && <span className="mr-auto self-center text-xs text-red-400">{finalizeM.error.message}</span>}
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800">Cancel</button>
          <button
            onClick={() => finalizeM.mutate()}
            disabled={!plan || ready.length === 0 || finalizeM.isPending}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {finalizeM.isPending && <Loader2 size={14} className="animate-spin" />}
            {onlyRaw ? "Delete the original" : ready.length === 1 ? "Finalize" : `Finalize ${ready.length}`}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-300">
        {!onlyRaw && (
          <p>
            The working files go — masks, overlays, crops, cleaned passes, patches — along with the stage state, the
            regions and their text, and older published versions. The final image stays{deleteRaw ? "" : ", and so does the original"}.
          </p>
        )}
        <Toggle checked={deleteRaw} onChange={setDeleteRaw} disabled={onlyRaw} className="text-sm">
          Also delete the original
        </Toggle>
        <p className="text-xs text-gray-500">
          {deleteRaw
            ? "Without its original the page is read-only for good: it can't be edited, run again or published, and the same image sent again starts a new page."
            : "With the original kept the page can be redone later: Run again rebuilds every stage from it."}
        </p>

        {planQ.isLoading ? (
          <Loader2 size={16} className="animate-spin text-gray-500" />
        ) : planQ.isError ? (
          <p className="text-sm text-red-400">Couldn't work out what would be removed: {planQ.error.message}</p>
        ) : plan ? (
          <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-950 p-3">
            {ready.length > 0 ? (
              <p>
                {files.length} file{files.length === 1 ? "" : "s"} from {ready.length} page{ready.length === 1 ? "" : "s"},
                freeing <span className="font-medium text-gray-100">{bytes(plan.bytes)}</span>.{" "}
                {files.length > 0 && (
                  <button type="button" onClick={() => setShowFiles(!showFiles)} className="text-xs text-indigo-300 hover:text-indigo-200">
                    {showFiles ? "Hide the list" : "Show the list"}
                  </button>
                )}
              </p>
            ) : (
              <p className="text-gray-400">Nothing here can be finalized as it stands.</p>
            )}
            {showFiles && (
              <ul className="max-h-40 overflow-y-auto font-mono text-[11px] text-gray-500">
                {files.map((file) => <li key={file}>{file}</li>)}
              </ul>
            )}
            {refused.length > 0 && (
              <ul className="space-y-0.5 text-xs text-amber-300">
                {refused.map((page) => (
                  <li key={page.id}>{pageIds.length > 1 ? `${page.id.slice(-8)}: ` : ""}Left as it is — {page.reason}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
