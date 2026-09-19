import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ShieldPlus } from "lucide-react";
import { ApiError, setupFirstAdmin } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { AuthButton } from "../components/AuthButton";
import { AuthField } from "../components/AuthField";
import { AuthShell } from "../components/AuthShell";
import { LoadFailure } from "../components/LoadFailure";
import { useToast } from "../components/Toast";

/** The first run: an empty server takes one admin, and the route closes behind itself. */
export function SetupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { needsSetup, loading, error, retry, refresh } = useAuth();
  /**
   * This screen exists only while the server has no accounts, so it asks again on arrival rather than trusting a
   * cached answer — a tab left open through the setup would otherwise still offer the form.
   */
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    void refresh().finally(() => setChecking(false));
  }, [refresh]);

  const settled = !checking && !loading;
  useEffect(() => {
    if (settled && !error && !needsSetup) toast.info("This server already has an account. Sign in instead.");
  }, [settled, error, needsSetup, toast]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const create = useMutation({
    mutationFn: () => setupFirstAdmin({ username: username.trim(), password }),
    onSuccess: async () => {
      await refresh();
      navigate("/home");
    },
    onError: async (error) => {
      // 409 means somebody set this server up while this page was open: ask again, and the guard above moves on
      if (error instanceof ApiError && error.status === 409) await refresh();
    },
  });

  if (!settled) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="animate-spin text-gray-600" />
      </div>
    );
  }
  // Not knowing whether the server has accounts is not the same as it having one
  if (error) return <LoadFailure message={error.message} onRetry={() => void retry()} />;
  if (!needsSetup) return <Navigate to="/login" replace />;

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = username.trim() !== "" && password.length >= 8 && password === confirm;

  return (
    <AuthShell
      title="Set up this server"
      subtitle="One admin account, which manages the library and everyone else. Reading stays open to anyone."
      footer="An authenticator app or a passkey can be added afterwards, from your account page."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) create.mutate();
        }}
      >
        <AuthField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          pattern="[A-Za-z0-9._-]+"
          title="Letters, digits, dots, dashes and underscores"
          placeholder="decky"
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          note={tooShort ? "Eight characters at least." : "Eight characters or more."}
          tone={tooShort ? "warn" : "hint"}
        />
        <AuthField
          label="Password again"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          note={mismatch ? "These two don't match." : undefined}
          tone="warn"
        />
        <AuthButton type="submit" disabled={!ready} pending={create.isPending} icon={<ShieldPlus size={15} />}>
          Create the admin account
        </AuthButton>
      </form>

      {create.error && <p className="mt-3 text-sm text-red-400">{create.error.message}</p>}
    </AuthShell>
  );
}
