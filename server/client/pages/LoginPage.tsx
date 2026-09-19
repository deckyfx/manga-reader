import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
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
import { AuthButton } from "../components/AuthButton";
import { AuthField } from "../components/AuthField";
import { AuthShell } from "../components/AuthShell";
import { LoadFailure } from "../components/LoadFailure";

/** Sign-in: a password, then a second factor when the account carries one. */
export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { account, needsSetup, registrationEnabled, loading, error: authError, retry, refresh } = useAuth();
  // Where the server sent us from, when a link needed signing in first; only ever a path on this server
  const next = params.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  /** Set once the password is accepted but the account wants more. */
  const [pending, setPending] = useState<{ challenge: string; methods: SecondFactor[] } | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const done = async () => {
    await refresh();
    navigate(destination);
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
  // Until the server has said who you are (a 401 counts as "a guest"), the form would be a guess
  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="animate-spin text-gray-600" />
      </div>
    );
  }
  if (authError) return <LoadFailure message={authError.message} onRetry={() => void retry()} />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (account) return <Navigate to={destination} replace />;

  const error = passwordM.error ?? codeM.error ?? passkeyM.error;

  const footer = (
    <div className="space-y-1">
      {registrationEnabled && !pending && (
        <p>No account? <Link to="/register" className="text-indigo-300 hover:text-indigo-200">Create one</Link></p>
      )}
      <p><Link to="/read" className="text-gray-400 hover:text-gray-200">Browse the library without signing in →</Link></p>
    </div>
  );

  return (
    <AuthShell
      title={pending ? "One more step" : "Sign in"}
      subtitle={pending
        ? "This account is protected by something beyond its password."
        : "Reading is open to everyone; signing in is for managing the library."}
      footer={footer}
    >
      {!pending ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim() && password) passwordM.mutate();
          }}
        >
          <AuthField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
          <AuthField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <AuthButton type="submit" disabled={!username.trim() || !password} pending={passwordM.isPending} icon={<LogIn size={15} />}>
            Sign in
          </AuthButton>
        </form>
      ) : (
        <div className="space-y-4">
          {pending.methods.includes("passkey") && (
            <AuthButton variant="quiet" onClick={() => passkeyM.mutate()} pending={passkeyM.isPending} icon={<KeyRound size={15} />}>
              Use a passkey
            </AuthButton>
          )}

          {pending.methods.includes("passkey") && pending.methods.includes("totp") && (
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-gray-600">
              <span className="h-px flex-1 bg-gray-800" />
              or
              <span className="h-px flex-1 bg-gray-800" />
            </div>
          )}

          {pending.methods.includes("totp") && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) codeM.mutate();
              }}
            >
              <AuthField
                label={useRecovery ? "Recovery code" : "Code from your authenticator"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                inputMode={useRecovery ? "text" : "numeric"}
                autoComplete="one-time-code"
                placeholder={useRecovery ? "12345-67890" : "123456"}
                className="text-center text-lg tracking-[0.3em]"
              />
              <AuthButton type="submit" disabled={!code.trim()} pending={codeM.isPending} icon={<ShieldCheck size={15} />}>
                Continue
              </AuthButton>
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
                // Otherwise the last step's complaint hangs under the password form
                codeM.reset();
                passkeyM.reset();
                passwordM.reset();
              }}
              className="ml-auto text-gray-400 hover:text-gray-200"
            >
              Start again
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error.message}</p>}
    </AuthShell>
  );
}
