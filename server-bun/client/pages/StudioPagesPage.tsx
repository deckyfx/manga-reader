import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { deletePage, listPages, pageFileUrl } from "../api";
import { NewPageDialog } from "../components/NewPageDialog";
import { StatusBadge } from "../components/StatusBadge";

/** Recently translated pages; open one to review and edit it, create one from an upload or image URL, or discard one. */
export function StudioPagesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const pagesQ = useQuery({ queryKey: ["studio-pages"], queryFn: listPages, refetchInterval: 5000 });
  const pages = pagesQ.data ?? [];
  const deleteM = useMutation({
    mutationFn: deletePage,
    onSettled: () => qc.invalidateQueries({ queryKey: ["studio-pages"] }),
  });

  const confirmDelete = (pageId: string) => {
    if (window.confirm("Discard this page? Its translation, edits, history and all its images are deleted. This can't be undone.")) {
      deleteM.mutate(pageId);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
        <h1 className="text-base font-semibold">Studio</h1>
        <span className="hidden sm:inline text-xs text-gray-500 mr-auto">Translate a page from the extension or here, then polish it</span>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus size={14} /> New page
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {pagesQ.isLoading && <Loader2 className="animate-spin text-gray-500" />}
        {pagesQ.error && <p className="text-sm text-red-400">{pagesQ.error.message}</p>}
        {deleteM.error && <p className="mb-3 text-sm text-red-400">Couldn't delete the page: {deleteM.error.message}</p>}
        {!pagesQ.isLoading && pages.length === 0 && <p className="text-sm text-gray-500">No pages yet.</p>}

        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {pages.map((page) => {
            const busy = page.status === "queued" || page.status === "running";
            const deleting = deleteM.isPending && deleteM.variables === page.id;
            return (
              <div key={page.id} className="relative group">
                <Link
                  to={`/studio/pages/${page.id}`}
                  className="flex flex-col bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-indigo-500 transition-colors"
                >
                  <div className="aspect-[2/3] bg-gray-950 overflow-hidden">
                    <img
                      src={pageFileUrl(page.id, page.has_result ? "result.png" : "original.png", `${page.updated_at}-${page.revision}`)}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <StatusBadge status={page.status} />
                    <span className="text-xs text-gray-500">rev {page.revision}</span>
                  </div>
                  <div className="px-3 pb-2 text-xs text-gray-500 truncate" title={page.source}>
                    {page.width}×{page.height} · {page.source === "upload" ? "upload" : page.source}
                  </div>
                </Link>
                <button
                  onClick={() => confirmDelete(page.id)}
                  disabled={busy || deleting}
                  title={busy ? "Can't discard while the page is being translated" : "Discard page and images"}
                  aria-label="Discard page"
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-gray-900/90 text-gray-400 hover:text-red-400 hover:bg-gray-800 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40 transition-opacity"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {creating && (
        <NewPageDialog
          onClose={() => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ["studio-pages"] });
          }}
          onCreated={(pageId) => {
            void qc.invalidateQueries({ queryKey: ["studio-pages"] });
            navigate(`/studio/pages/${pageId}`);
          }}
        />
      )}
    </div>
  );
}
