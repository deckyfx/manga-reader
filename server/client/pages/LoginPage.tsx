import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react";
import {
  login,
  loginWithPasskey,
  loginWithRecoveryCode,
  loginWithTotp,
  passkeyLoginOptions,
  type SecondFactor,
} from "../api";
import { useAuth } from "../auth/AuthProvider";
import { startAssertion } from "../auth/webauthn";

const field = "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none";

/** Sign-in: a password, then a second factor when the account carries one. */
export function LoginPage() {
  const navigate = useNavigate();
  const { account, needsSetup, registrationEnabled, refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  /** Set once the password is accepted but the account wants more. */
  const [pending, setPending] = useState<{ challenge: string; methods: SecondFactor[] } | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const done = async () => {
    await refresh();
    navigate("/home");
  };

  const passwordM = useMutation({
    mutationFn: () => login({ username: username.trim(), password }),
    onSuccess: async (result) => {
      if (result.mfa_required && result.challenge) {
        setPending({ challenge: result.challenge, methods: result.methods as SecondFactor[] });
        return;
      }
      await done();
    },
  });

  const codeM = useMutation({
    mutationFn: () => {
      const challenge = pending?.challenge ?? "";
      return useRecovery ? loginWithRecoveryCode({ challenge, code: code.trim() }) : loginWithTotp({ challenge, code: code.trim() });
    },
    onSuccess: done,
  });

  const passkeyM = useMutation({
    mutationFn: async () => {
      const challenge = pending?.challenge ?? "";
      const options = await passkeyLoginOptions(challenge);
      const response = await startAssertion(options as Parameters<typeof startAssertion>[0]);
      return loginWithPasskey({ challenge, response });
    },
    onSuccess: done,
  });

  // A server with no accounts wants its first admin before anything else
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (account) return <Navigate to="/home" replace />;

  const error = passwordM.error ?? codeM.error ?? passkeyM.error;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-gray-400">
          {pending ? "One more step for this account." : "Reading is open to everyone; signing in is for managing the library."}
        </p>

        {!pending ? (
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (username.trim() && password) passwordM.mutate();
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs text-gray-400">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-gray-400">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={field} />
            </label>
            <button
              type="submit"
              disabled={!username.trim() || !password || passwordM.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {passwordM.isPending ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
              Sign in
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-3">
            {pending.methods.includes("passkey") && (
              <button
                onClick={() => passkeyM.mutate()}
                disabled={passkeyM.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700 disabled:opacity-50"
              >
                {passkeyM.isPending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Use a passkey
              </button>
            )}

            {pending.methods.includes("totp") && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim()) codeM.mutate();
                }}
              >
                <label className="block space-y-1">
                  <span className="text-xs text-gray-400">{useRecovery ? "Recovery code" : "Code from your authenticator"}</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                    inputMode={useRecovery ? "text" : "numeric"}
                    autoComplete="one-time-code"
                    placeholder={useRecovery ? "12345-67890" : "123456"}
                    className={`${field} tracking-widest`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!code.trim() || codeM.isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {codeM.isPending ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                  Continue
                </button>
              </form>
            )}

            <div className="flex items-center justify-between text-xs">
              {pending.methods.includes("totp") && (
                <button onClick={() => setUseRecovery((on) => !on)} className="text-indigo-300 hover:text-indigo-200">
                  {useRecovery ? "Use an authenticator code" : "Lost your authenticator?"}
                </button>
              )}
              <button
                onClick={() => {
                  setPending(null);
                  setCode("");
                  setUseRecovery(false);
                }}
                className="ml-auto text-gray-400 hover:text-white"
              >
                Start again
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error.message}</p>}

        {registrationEnabled && !pending && (
          <p className="mt-4 text-xs text-gray-500">
            No account? <Link to="/register" className="text-indigo-300 hover:text-indigo-200">Create one</Link>
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          <Link to="/read" className="text-gray-400 hover:text-white">Browse the library without signing in →</Link>
        </p>
      </div>
    </div>
  );
}
