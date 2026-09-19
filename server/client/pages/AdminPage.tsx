import { useState } from "react";
import { Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, Plus, ShieldAlert, Trash2, UserCog } from "lucide-react";
import {
  createUser,
  deleteUser,
  endAnySession,
  getServerPolicy,
  listAllSessions,
  listUsers,
  updateServerPolicy,
  updateUser,
  type AccountSummary,
  type RegistrationRole,
  type UserRole,
} from "../api";
import { useAuth } from "../auth/AuthProvider";
import { LoadFailure } from "../components/LoadFailure";
import { when } from "../lib/format";
import { useConfirm } from "../components/ConfirmDialog";
import { SecretInput } from "../components/SecretInput";

const field = "rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none";
const ROLES: UserRole[] = ["admin", "contributor", "reader"];
/** Self-registration can't mint admins, so the default-role picker doesn't offer it. */
const REGISTRATION_ROLES: RegistrationRole[] = ["contributor", "reader"];

/** Server-level settings: who may join, who is who, and where everyone is signed in. */
export function AdminPage() {
  const { account, loading, error, retry } = useAuth();
  if (loading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  // A failed lookup is not a confirmed guest: bouncing to the sign-in screen would hide a server that is simply down
  if (error) return <LoadFailure message={error.message} onRetry={() => void retry()} />;
  if (!account) return <Navigate to="/login" replace />;
  if (account.role !== "admin") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <ShieldAlert size={16} className="text-amber-400" />
          This area is for admins.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">Server</h1>
          <p className="mt-1 text-sm text-gray-400">Settings for the whole server, its accounts and its sessions.</p>
        </header>
        <PolicySection />
        <UsersSection myId={account.id} />
        <SessionsSection />
      </div>
    </div>
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

function PolicySection() {
  const qc = useQueryClient();
  const policyQ = useQuery({ queryKey: ["server-policy"], queryFn: getServerPolicy });
  const saveM = useMutation({
    mutationFn: (changes: { registration_enabled?: boolean; default_role?: RegistrationRole }) => updateServerPolicy(changes),
    onSuccess: (policy) => {
      qc.setQueryData(["server-policy"], policy);
      // The sign-in screen offers "create an account" based on this
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const policy = policyQ.data;

  return (
    <Section title="Registration" description="With this off, accounts come from you; reading stays open to everyone either way.">
      {policyQ.isError ? (
        <p className="text-sm text-red-400">These settings couldn't be read: {policyQ.error.message}</p>
      ) : policyQ.isLoading || !policy ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={policy.registration_enabled}
              onChange={(e) => saveM.mutate({ registration_enabled: e.target.checked })}
              disabled={saveM.isPending}
              className="accent-indigo-500"
            />
            Let people create their own accounts
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            New accounts start as
            <select
              value={policy.default_role}
              onChange={(e) => saveM.mutate({ default_role: e.target.value as RegistrationRole })}
              disabled={saveM.isPending || !policy.registration_enabled}
              title="Anyone who signs up gets this; admins are made here, one at a time"
              className={field}
            >
              {REGISTRATION_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          {saveM.isPending && <Loader2 size={14} className="animate-spin text-gray-500" />}
        </div>
      )}
      {saveM.error && <p className="mt-2 text-sm text-red-400">{saveM.error.message}</p>}
    </Section>
  );
}

function UsersSection({ myId }: { myId: number }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const usersQ = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("reader");
  const [resetting, setResetting] = useState<{ id: number; value: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["users"] });
    void qc.invalidateQueries({ queryKey: ["admin-sessions"] });
  };

  const addM = useMutation({
    mutationFn: () => createUser({ username: username.trim(), password, role }),
    onSuccess: () => {
      setUsername("");
      setPassword("");
      refresh();
    },
  });
  const updateM = useMutation({
    mutationFn: ({ id, ...changes }: { id: number; role?: UserRole; disabled?: boolean; password?: string }) => updateUser(id, changes),
    onSuccess: refresh,
  });
  const deleteM = useMutation({ mutationFn: (id: number) => deleteUser(id), onSuccess: refresh });

  const remove = async (user: AccountSummary) => {
    const ok = await confirm({
      title: `Delete ${user.username}?`,
      message: "Their sessions, API keys, authenticators and passkeys go with the account. Pages they made stay.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (ok) deleteM.mutate(user.id);
  };

  const users = usersQ.data ?? [];
  const error = addM.error ?? updateM.error ?? deleteM.error;

  return (
    <Section title="Accounts" description="Changing a role or suspending an account signs it out everywhere.">
      {usersQ.isError ? (
        <p className="text-sm text-red-400">The accounts couldn't be read: {usersQ.error.message}</p>
      ) : usersQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <UserCog size={14} className="text-gray-500" />
              <span className="text-sm">{user.display_name ?? user.username}</span>
              <span className="text-xs text-gray-500">{user.username}</span>
              {user.disabled && <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[11px] text-red-300">suspended</span>}
              {user.id === myId && <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-[11px] text-indigo-200">you</span>}

              <select
                value={user.role}
                onChange={(e) => updateM.mutate({ id: user.id, role: e.target.value as UserRole })}
                disabled={updateM.isPending || user.id === myId}
                title={user.id === myId ? "Another admin has to change your role" : undefined}
                aria-label={`Role for ${user.username}`}
                className={`ml-auto ${field} py-1 text-xs`}
              >
                {ROLES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>

              <button
                onClick={() => updateM.mutate({ id: user.id, disabled: !user.disabled })}
                disabled={updateM.isPending || user.id === myId}
                title={user.id === myId ? "You can't suspend yourself" : user.disabled ? "Let them back in" : "Suspend this account"}
                aria-label={`${user.disabled ? "Restore" : "Suspend"} ${user.username}`}
                className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
              >
                {user.disabled ? "Restore" : "Suspend"}
              </button>

              <button
                onClick={() => setResetting({ id: user.id, value: "" })}
                aria-label={`Set a password for ${user.username}`}
                className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
              >
                Set password
              </button>

              <button
                onClick={() => void remove(user)}
                disabled={deleteM.isPending || user.id === myId}
                title={user.id === myId ? "You can't delete your own account" : "Delete this account"}
                aria-label={`Delete ${user.username}`}
                className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-300 disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {resetting && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-800 bg-gray-950 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (resetting.value.length >= 8) {
              // Closed only once it worked: a failure keeps the form, and what was typed, for another go
              updateM.mutate({ id: resetting.id, password: resetting.value }, { onSuccess: () => setResetting(null) });
            }
          }}
        >
          <label className="min-w-40 flex-1 space-y-1">
            <span className="text-xs text-gray-400">New password for this account (they're signed out everywhere)</span>
            <SecretInput
              autoFocus
              value={resetting.value}
              onChange={(e) => setResetting({ ...resetting, value: e.target.value })}
              placeholder="At least eight characters"
            />
          </label>
          <button type="submit" disabled={resetting.value.length < 8} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Set</button>
          <button type="button" onClick={() => setResetting(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800">Cancel</button>
        </form>
      )}

      <form
        className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-800 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (username.trim() && password.length >= 8) addM.mutate();
        }}
      >
        <label className="min-w-36 flex-1 space-y-1">
          <span className="text-xs text-gray-400">Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="letterer" className={`w-full ${field}`} />
        </label>
        <label className="min-w-36 flex-1 space-y-1">
          <span className="text-xs text-gray-400">Password</span>
          <SecretInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least eight characters" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-gray-400">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={`${field} block`}>
            {ROLES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!username.trim() || password.length < 8 || addM.isPending} className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50">
          <Plus size={13} /> Add account
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-400">{error.message}</p>}
    </Section>
  );
}

function SessionsSection() {
  const qc = useQueryClient();
  const sessionsQ = useQuery({ queryKey: ["admin-sessions"], queryFn: listAllSessions });
  const endM = useMutation({ mutationFn: (id: string) => endAnySession(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-sessions"] }) });
  const sessions = sessionsQ.data ?? [];

  return (
    <Section title="Sessions" description="Every browser signed in to this server right now.">
      {sessionsQ.isError ? (
        <p className="text-sm text-red-400">The sessions couldn't be read: {sessionsQ.error.message}</p>
      ) : sessionsQ.isLoading ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500">Nobody is signed in.</p>
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-2 bg-gray-950 px-3 py-2">
              <span className="text-sm">{session.username}</span>
              <span className="max-w-64 truncate text-xs text-gray-500" title={session.user_agent ?? undefined}>
                {session.user_agent ?? "unknown device"}
              </span>
              {session.current && <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[11px] text-emerald-300">this one</span>}
              <span className="ml-auto text-xs text-gray-500">last seen {when(session.last_seen_at)}</span>
              {!session.current && (
                <button
                  onClick={() => endM.mutate(session.id)}
                  disabled={endM.isPending}
                  aria-label={`Sign out ${session.username}`}
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
