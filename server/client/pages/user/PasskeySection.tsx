import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { listPasskeys, passkeyRegistrationOptions, removePasskey, savePasskey } from "../../api";
import { startRegistration, supportsPasskeys } from "../../auth/webauthn";
import { useConfirm } from "../../components/ConfirmDialog";
import { ListError } from "../../components/ListError";
import { when } from "../../lib/format";
import { fieldClass } from "../../lib/styles";

const field = `w-full ${fieldClass}`;

/** A fingerprint, face or security key, confirming your password rather than replacing it. */
export function PasskeySection({ canUse }: { canUse: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listQ = useQuery({ queryKey: ["passkeys"], queryFn: listPasskeys });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const usable = supportsPasskeys();

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["passkeys"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
  };

  const addM = useMutation({
    mutationFn: async () => {
      const { challenge, options } = await passkeyRegistrationOptions();
      const response = await startRegistration(options as Parameters<typeof startRegistration>[0]);
      return savePasskey({ challenge, name: name.trim(), response });
    },
    onSuccess: () => {
      setName("");
      refresh();
    },
  });
  const removeM = useMutation({ mutationFn: ({ id, pass }: { id: string; pass: string }) => removePasskey(id, pass), onSuccess: refresh });

  const remove = async (id: string, label: string) => {
    if (!password) return;
    const ok = await confirm({ title: `Remove ${label}?`, message: "That passkey stops working for this account.", confirmLabel: "Remove", danger: true });
    if (ok) removeM.mutate({ id, pass: password });
  };

  const keys = listQ.data ?? [];

  return (
    <div className="max-w-3xl">
      {!usable && (
        <p className="mb-3 rounded-lg border border-gray-800 bg-gray-950 p-2 text-xs text-amber-300">
          This browser can't use passkeys here. They need a secure page — localhost counts, a plain-http address on your
          network doesn't.
        </p>
      )}
      {listQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : listQ.isError ? (
        <ListError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : keys.length === 0 ? (
        <p className="text-sm text-gray-500">None yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <KeyRound size={14} className="text-gray-500" />
              <span className="text-sm">{key.name}</span>
              <span className="ml-auto text-xs text-gray-500">last used {when(key.last_used_at)}</span>
              <button
                onClick={() => void remove(key.id, key.name)}
                disabled={!password || removeM.isPending}
                title={password ? "Remove this passkey" : "Type your password first"}
                aria-label={`Remove ${key.name}`}
                className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) addM.mutate();
        }}
      >
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-xs text-gray-400">Add a passkey</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Laptop" maxLength={60} disabled={!usable || !canUse} className={field} />
        </label>
        <button type="submit" disabled={!usable || !canUse || !name.trim() || addM.isPending} className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50">
          {addM.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
        </button>
      </form>

      <label className="mt-3 block max-w-xs space-y-1">
        <span className="text-xs text-gray-400">Your password — needed to remove one</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={field} />
      </label>

      {(addM.error ?? removeM.error) && <p className="mt-2 text-sm text-red-400">{(addM.error ?? removeM.error)?.message}</p>}
    </div>
  );
}
