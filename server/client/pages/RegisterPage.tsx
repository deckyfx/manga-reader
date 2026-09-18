import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { register } from "../api";
import { useAuth } from "../auth/AuthProvider";

const field = "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none";

/** Self-registration, which only exists while an admin has it switched on. */
export function RegisterPage() {
  const navigate = useNavigate();
  const { account, needsSetup, registrationEnabled, loading, refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const create = useMutation({
    mutationFn: () => register({ username: username.trim(), password }),
    onSuccess: async () => {
      await refresh();
      navigate("/home");
    },
  });

  if (loading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (account) return <Navigate to="/home" replace />;

  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h1 className="text-lg font-semibold">Create an account</h1>

        {!registrationEnabled ? (
          <>
            <p className="mt-2 text-sm text-gray-400">
              This server isn't taking new accounts. Ask an admin to make you one, or to switch registration on.
            </p>
            <Link to="/login" className="mt-4 inline-block text-sm text-indigo-300 hover:text-indigo-200">← Back to sign in</Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-400">You can add an authenticator app or a passkey afterwards.</p>
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (username.trim() && password.length >= 8 && password === confirm) create.mutate();
              }}
            >
              <label className="block space-y-1">
                <span className="text-xs text-gray-400">Username</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  pattern="[A-Za-z0-9._-]+"
                  title="Letters, digits, dots, dashes and underscores"
                  className={field}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-gray-400">Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={field} />
                {password.length > 0 && password.length < 8 && <span className="text-xs text-amber-400">Eight characters at least.</span>}
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-gray-400">Password again</span>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={field} />
                {mismatch && <span className="text-xs text-amber-400">These two don't match.</span>}
              </label>
              <button
                type="submit"
                disabled={!username.trim() || password.length < 8 || password !== confirm || create.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {create.isPending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
                Create account
              </button>
            </form>
            {create.error && <p className="mt-3 text-sm text-red-400">{create.error.message}</p>}
            <p className="mt-4 text-xs text-gray-500">
              Already have one? <Link to="/login" className="text-indigo-300 hover:text-indigo-200">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
