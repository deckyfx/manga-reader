import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { createApiKey, listApiKeys, revokeApiKey } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { ListError } from "../../components/ListError";
import { when } from "../../lib/format";
import { fieldClass } from "../../lib/styles";

const field = `w-full ${fieldClass}`;

/** What the browser extension and the desktop app sign in with. */
export function ApiKeySection({ canUse }: { canUse: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listQ = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const createM = useMutation({
    mutationFn: () => createApiKey(name.trim()),
    onSuccess: (created) => {
      setFresh({ name: created.name, key: created.key });
      setName("");
      setCopied(false);
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revokeM = useMutation({ mutationFn: (id: number) => revokeApiKey(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }) });

  const revoke = async (id: number, label: string) => {
    const ok = await confirm({
      title: `Revoke ${label}?`,
      message: "Anything using this key stops working at once — the extension, the desktop app.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (ok) revokeM.mutate(id);
  };

  const keys = listQ.data ?? [];

  return (
    <div className="max-w-3xl">
      {listQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : listQ.isError ? (
        <ListError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : keys.length === 0 ? (
        <p className="text-sm text-gray-500">No keys yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <span className="text-sm">{key.name}</span>
              <code className="rounded bg-gray-900 px-1.5 py-0.5 text-xs text-gray-400">{key.prefix}…</code>
              {key.revoked && <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[11px] text-red-300">revoked</span>}
              <span className="ml-auto text-xs text-gray-500">last used {when(key.last_used_at)}</span>
              {!key.revoked && (
                <button
                  onClick={() => void revoke(key.id, key.name)}
                  disabled={revokeM.isPending}
                  aria-label={`Revoke ${key.name}`}
                  className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {fresh && (
        <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
          <p className="text-sm font-medium text-amber-200">{fresh.name} — copy it now, it isn't shown again</p>
          <code className="mt-2 block break-all rounded bg-gray-950 px-2 py-1.5 text-xs text-amber-100">{fresh.key}</code>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fresh.key);
                  setCopied(true);
                } catch {
                  // Clipboard refused; the key is on screen
                }
              }}
              className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setFresh(null)} className="text-xs text-gray-400 hover:text-white">Done</button>
          </div>
        </div>
      )}

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createM.mutate();
        }}
      >
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-xs text-gray-400">New key</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Browser extension" maxLength={60} disabled={!canUse} className={field} />
        </label>
        <button type="submit" disabled={!canUse || !name.trim() || createM.isPending} className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50">
          <Plus size={13} /> Create
        </button>
      </form>
      {!canUse && <p className="mt-2 text-xs text-gray-500">Reader accounts don't use API keys.</p>}
      {(createM.error ?? revokeM.error) && <p className="mt-2 text-sm text-red-400">{(createM.error ?? revokeM.error)?.message}</p>}
    </div>
  );
}
