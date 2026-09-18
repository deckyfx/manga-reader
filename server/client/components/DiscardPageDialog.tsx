import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderMinus, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { deletePage, rollbackPage, unfilePage } from "../api";
import { Modal } from "./Modal";

interface DiscardPageDialogProps {
  page: {
    id: string;
    revision: number;
    published?: boolean;
    has_edits?: boolean;
    location?: { chapter_title: string; series_title: string; index: number; total: number } | null;
  };
  onClose: () => void;
  /** `deleted` tells the caller the page is gone, so it can navigate away instead of refetching it. */
  onDone: (outcome: { deleted: boolean }) => void;
}

/**
 * What "discard" means depends on where the page lives. A draft in the Inbox is simply deleted; a page inside a
 * chapter is part of what people read, so the choice is spelled out: drop the unpublished edits, take the page out of
 * the chapter, or delete it and its images for good.
 */
export function DiscardPageDialog({ page, onClose, onDone }: DiscardPageDialogProps) {
  const qc = useQueryClient();
  const filed = page.location ?? null;

  const refresh = (deleted: boolean) => {
    void qc.invalidateQueries({ queryKey: ["studio-pages"] });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    if (filed) void qc.invalidateQueries({ queryKey: ["chapter"] });
    if (!deleted) void qc.invalidateQueries({ queryKey: ["page", page.id] });
    onDone({ deleted });
  };

  const rollbackM = useMutation({ mutationFn: () => rollbackPage(page.id, page.revision), onSuccess: () => refresh(false) });
  const unfileM = useMutation({ mutationFn: () => unfilePage(page.id), onSuccess: () => refresh(false) });
  const deleteM = useMutation({ mutationFn: () => deletePage(page.id, filed !== null), onSuccess: () => refresh(true) });
  const busy = rollbackM.isPending || unfileM.isPending || deleteM.isPending;
  const error = rollbackM.error ?? unfileM.error ?? deleteM.error;

  if (!filed) {
    return (
      <Modal
        title="Discard this page?"
        onClose={onClose}
        footer={
          <>
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800">Cancel</button>
            <button
              onClick={() => deleteM.mutate()}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {deleteM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Discard page
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-400">Its translation, edits, publish history and all its images are deleted. This can't be undone.</p>
        {error && <p className="mt-3 text-sm text-red-400">{error.message}</p>}
      </Modal>
    );
  }

  return (
    <Modal title={`This page is page ${filed.index} of ${filed.chapter_title}`} onClose={onClose}>
      <p className="text-sm text-gray-400">
        It belongs to {filed.series_title}, so people reading the chapter would notice it go. What would you like to do?
      </p>
      <div className="mt-4 space-y-2">
        {page.published && page.has_edits && (
          <Choice
            icon={<RotateCcw size={16} />}
            title="Discard the edits"
            description="Puts the published version back as the working image. Readers see no change — they already have it."
            pending={rollbackM.isPending}
            disabled={busy}
            onClick={() => rollbackM.mutate()}
          />
        )}
        <Choice
          icon={<FolderMinus size={16} />}
          title="Remove from the chapter"
          description="The page and all its images survive and return to the Inbox; the chapter loses this page."
          pending={unfileM.isPending}
          disabled={busy}
          onClick={() => unfileM.mutate()}
        />
        <Choice
          icon={<Trash2 size={16} />}
          title="Delete the page and its images"
          description="The page leaves the chapter and everything it holds is deleted. This can't be undone."
          danger
          pending={deleteM.isPending}
          disabled={busy}
          onClick={() => deleteM.mutate()}
        />
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error.message}</p>}
    </Modal>
  );
}

function Choice({ icon, title, description, onClick, pending, disabled, danger }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  pending: boolean;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
        danger ? "border-red-900/60 bg-red-950/20 hover:border-red-500" : "border-gray-800 bg-gray-950 hover:border-indigo-500"
      }`}
    >
      <span className={`mt-0.5 ${danger ? "text-red-300" : "text-gray-400"}`}>{pending ? <Loader2 size={16} className="animate-spin" /> : icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-100">{title}</span>
        <span className="block text-xs text-gray-400">{description}</span>
      </span>
    </button>
  );
}
