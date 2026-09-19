import { useState } from "react";
import { Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, LogOut, Plus, Shield, Smartphone, Trash2, X } from "lucide-react";
import {
  addAuthenticator,
  changePassword,
  confirmAuthenticator,
  createApiKey,
  endMySession,
  listApiKeys,
  listAuthenticators,
  listMySessions,
  listPasskeys,
  passkeyRegistrationOptions,
  reissueRecoveryCodes,
  removeAuthenticator,
  removePasskey,
  revokeApiKey,
  savePasskey,
} from "../api";
import { useAuth } from "../auth/AuthProvider";
import { LoadFailure } from "../components/LoadFailure";
import { when } from "../lib/format";
import { startRegistration, supportsPasskeys } from "../auth/webauthn";
import { useConfirm } from "../components/ConfirmDialog";

const field = "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none";
const ROLE_LABEL: Record<string, string> = { admin: "Admin", contributor: "Contributor", reader: "Reader" };

/** Your own account: password, the things that guard it, the keys your tools use, and where you're signed in. */
export function UserPage() {
  const { account, loading, error, retry } = useAuth();
  if (loading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  // A failed lookup is not a confirmed guest: bouncing to the sign-in screen would hide a server that is simply down
  if (error) return <LoadFailure message={error.message} onRetry={() => void retry()} />;
  if (!account) return <Navigate to="/login" replace />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">{account.display_name ?? account.username}</h1>
          <p className="mt-1 text-sm text-gray-400">
            Signed in as <span className="text-gray-300">{account.username}</span> · {ROLE_LABEL[account.role] ?? account.role}
          </p>
        </header>

        <PasswordSection />
        <AuthenticatorSection />
        <PasskeySection canUse={account.role !== "reader"} />
        <ApiKeySection canUse={account.role !== "reader"} />
        <SessionSection />
      </div>
    </div>
  );
}

/** A list that couldn't be loaded (or reloaded): say so, rather than showing it empty or out of date. */
function ListError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <p className="text-sm text-red-400">
      Couldn't load this list: {error.message}{" "}
      <button type="button" onClick={onRetry} className="text-gray-300 underline hover:text-white">Try again</button>
    </p>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
      {description && <p className="mt-1 text-xs text-gray-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PasswordSection() {
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
    <Section title="Password" description="Changing it signs this account out everywhere else.">
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
    </Section>
  );
}

/** Authenticator apps: a phone and a laptop can each hold one. */
function AuthenticatorSection() {
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
    <Section title="Authenticator apps" description="A code from an app, on top of your password. Add as many devices as you like.">
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
    </Section>
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

function PasskeySection({ canUse }: { canUse: boolean }) {
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
    <Section title="Passkeys" description="A fingerprint, face or security key, confirming your password rather than replacing it.">
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
    </Section>
  );
}

function ApiKeySection({ canUse }: { canUse: boolean }) {
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
    <Section title="API keys" description="What the browser extension and the desktop app sign in with. OCR refuses to run without one.">
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
    </Section>
  );
}

function SessionSection() {
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: ["my-sessions"], queryFn: listMySessions });
  const endM = useMutation({ mutationFn: (id: string) => endMySession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["my-sessions"] }) });
  const sessions = listQ.data ?? [];

  return (
    <Section title="Where you're signed in" description="Sign out anything you don't recognise.">
      {listQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : listQ.isError ? (
        <ListError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <span className="max-w-72 truncate text-sm text-gray-300" title={session.user_agent ?? undefined}>
                {session.user_agent ?? "unknown device"}
              </span>
              {session.current && <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[11px] text-emerald-300">this one</span>}
              <span className="ml-auto text-xs text-gray-500">last seen {when(session.last_seen_at)}</span>
              {!session.current && (
                <button
                  onClick={() => endM.mutate(session.id)}
                  disabled={endM.isPending}
                  aria-label="Sign this session out"
                  className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
                >
                  <LogOut size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {endM.error && <p className="mt-2 text-sm text-red-400">{endM.error.message}</p>}
    </Section>
  );
}
