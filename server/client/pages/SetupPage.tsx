import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ShieldPlus } from "lucide-react";
import { ApiError, setupFirstAdmin } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { AuthButton } from "../components/AuthButton";
import { AuthField } from "../components/AuthField";
import { AuthShell } from "../components/AuthShell";

/** The first run: an empty server takes one admin, and the route closes behind itself. */
export function SetupPage() {
  const navigate = useNavigate();
  const { needsSetup, loading, refresh } = useAuth();
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
      // 409 means somebody set this server up while this page was open: ask again, and the guard below moves on
      if (error instanceof ApiError && error.status === 409) await refresh();
    },
  });

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="animate-spin text-gray-600" />
      </div>
    );
  }
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
