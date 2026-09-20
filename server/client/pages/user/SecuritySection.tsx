import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Plus, Shield, Smartphone, Trash2, X } from "lucide-react";
import {
  addAuthenticator,
  changePassword,
  confirmAuthenticator,
  listAuthenticators,
  reissueRecoveryCodes,
  removeAuthenticator,
} from "../../api";
import { Card } from "../../components/Card";
import { useConfirm } from "../../components/ConfirmDialog";
import { ListError } from "../../components/ListError";
import { when } from "../../lib/format";
import { fieldClass } from "../../lib/styles";

const field = `w-full ${fieldClass}`;

/** The password itself, and the authenticator apps that sit on top of it. */
export function SecuritySection() {
  return (
    <div className="space-y-5">
      <PasswordCard />
      <AuthenticatorCard />
    </div>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => changePassword({ current, next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
    },
  });

  return (
    <Card title="Password" description="Changing it signs this account out everywhere else.">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (current && next.length >= 8) change.mutate();
        }}
      >
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-xs text-gray-400">Current password</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className={field} />
        </label>
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-xs text-gray-400">New password</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className={field} />
        </label>
        <button
          type="submit"
          disabled={!current || next.length < 8 || change.isPending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {change.isPending ? <Loader2 size={14} className="animate-spin" /> : "Change"}
        </button>
      </form>
      {change.error && <p className="mt-2 text-sm text-red-400">{change.error.message}</p>}
      {change.isSuccess && <p className="mt-2 text-sm text-emerald-400">Password changed.</p>}
    </Card>
  );
}

/** Authenticator apps: a phone and a laptop can each hold one. */
function AuthenticatorCard() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const listQ = useQuery({ queryKey: ["authenticators"], queryFn: listAuthenticators });
  const [name, setName] = useState("");
  const [enrolling, setEnrolling] = useState<{ id: number; secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["authenticators"] });
    void qc.invalidateQueries({ queryKey: ["me"] });
  };

  const startM = useMutation({
    mutationFn: () => addAuthenticator(name.trim()),
    onSuccess: (started) => {
      setEnrolling({ id: started.id, secret: started.secret, uri: started.uri });
      setName("");
    },
  });
  const confirmM = useMutation({
    mutationFn: () => confirmAuthenticator(enrolling?.id ?? 0, code.trim()),
    onSuccess: (result) => {
      setEnrolling(null);
      setCode("");
      if (result.recovery_codes.length > 0) setCodes(result.recovery_codes);
      refresh();
    },
  });
  const removeM = useMutation({ mutationFn: ({ id, pass }: { id: number; pass: string }) => removeAuthenticator(id, pass), onSuccess: refresh });
  const reissueM = useMutation({ mutationFn: (pass: string) => reissueRecoveryCodes(pass), onSuccess: (result) => setCodes(result.recovery_codes) });

  const remove = async (id: number, label: string) => {
    if (!password) return;
    const ok = await confirm({
      title: `Remove ${label}?`,
      message: "That device stops being able to sign you in. Any others stay.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) removeM.mutate({ id, pass: password });
  };

  const devices = listQ.data ?? [];
  const error = startM.error ?? confirmM.error ?? removeM.error ?? reissueM.error;

  return (
    <Card title="Authenticator apps" description="A code from an app, on top of your password. Add as many devices as you like.">
      {listQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : listQ.isError ? (
        <ListError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : devices.length === 0 ? (
        <p className="text-sm text-gray-500">None yet — your password alone signs you in.</p>
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <Smartphone size={14} className="text-gray-500" />
              <span className="text-sm">{device.name}</span>
              {!device.confirmed && <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[11px] text-amber-300">half-finished</span>}
              <span className="ml-auto text-xs text-gray-500">last used {when(device.last_used_at)}</span>
              <button
                onClick={() => void remove(device.id, device.name)}
                disabled={!password || removeM.isPending}
                title={password ? "Remove this device" : "Type your password below first"}
                aria-label={`Remove ${device.name}`}
                className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {enrolling ? (
        <div className="mt-4 space-y-3 rounded-lg border border-indigo-900/60 bg-indigo-950/20 p-3">
          <p className="text-xs text-gray-300">
            Scan this in your authenticator app, or type the key in by hand, then enter the six digits it shows.
          </p>
          <code className="block break-all rounded bg-gray-950 px-2 py-1.5 text-xs text-indigo-200">{enrolling.secret}</code>
          <a href={enrolling.uri} className="block text-xs text-indigo-300 hover:text-indigo-200">Open in an authenticator app →</a>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) confirmM.mutate();
            }}
          >
            <label className="space-y-1">
              <span className="text-xs text-gray-400">Code</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" className={`${field} w-32 tracking-widest`} />
            </label>
            <button type="submit" disabled={!code.trim() || confirmM.isPending} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
              {confirmM.isPending ? <Loader2 size={14} className="animate-spin" /> : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEnrolling(null);
                // The device was created when enrolment started; show the list as the server has it now
                void qc.invalidateQueries({ queryKey: ["authenticators"] });
              }}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </button>
          </form>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) startM.mutate();
          }}
        >
          <label className="min-w-40 flex-1 space-y-1">
            <span className="text-xs text-gray-400">Add a device</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Phone" maxLength={60} className={field} />
          </label>
          <button type="submit" disabled={!name.trim() || startM.isPending} className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50">
            <Plus size={13} /> Add
          </button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-800 pt-4">
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-xs text-gray-400">Your password — needed to remove a device or reissue codes</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={field} />
        </label>
        {devices.some((device) => device.confirmed) && (
          <button
            onClick={() => password && reissueM.mutate(password)}
            disabled={!password || reissueM.isPending}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            New recovery codes
          </button>
        )}
      </div>

      {codes && <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />}
      {error && <p className="mt-2 text-sm text-red-400">{error.message}</p>}
    </Card>
  );
}

/** Shown once. Losing these and the authenticator together means an admin has to reset the account. */
function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      // Clipboard can be refused; the codes are on screen to copy by hand
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
      <div className="flex items-center gap-2">
        <Shield size={14} className="text-amber-300" />
        <span className="text-sm font-medium text-amber-200">Recovery codes — you won't see these again</span>
        <button onClick={onClose} aria-label="Dismiss" className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white">
          <X size={13} />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-amber-100 sm:grid-cols-3">
        {codes.map((code) => <span key={code}>{code}</span>)}
      </div>
      <button onClick={() => void copy()} className="mt-2 flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200">
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy all"}
      </button>
    </div>
  );
}
