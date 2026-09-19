import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { ApiError, register } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { AuthButton } from "../components/AuthButton";
import { AuthField } from "../components/AuthField";
import { AuthShell } from "../components/AuthShell";
import { LoadFailure } from "../components/LoadFailure";
import { useToast } from "../components/Toast";

/** Self-registration, which only exists while an admin has it switched on. */
export function RegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { account, needsSetup, registrationEnabled, loading, error, retry, refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const create = useMutation({
    mutationFn: () => register({ username: username.trim(), password }),
    onSuccess: async () => {
      await refresh();
      navigate("/home");
    },
    onError: async (error) => {
      // Registration switched off, or the server set up, while this page was open — re-read and show what's true now
      if (error instanceof ApiError && (error.status === 403 || error.status === 409)) {
        toast.info("This server isn't taking new accounts any more.");
        await refresh();
      }
    },
  });

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="animate-spin text-gray-600" />
      </div>
    );
  }
  // An unreachable server hasn't said registration is off
  if (error) return <LoadFailure message={error.message} onRetry={() => void retry()} />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (account) return <Navigate to="/home" replace />;

  if (!registrationEnabled) {
    return (
      <AuthShell
        title="Create an account"
        subtitle="This server isn't taking new accounts. Ask an admin to make you one, or to switch registration on."
        footer={<Link to="/read" className="text-gray-400 hover:text-gray-200">Browse the library without an account →</Link>}
      >
        <Link
          to="/login"
          className="flex w-full items-center justify-center rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
        >
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = username.trim() !== "" && password.length >= 8 && password === confirm;

  return (
    <AuthShell
      title="Create an account"
      subtitle="You can add an authenticator app or a passkey afterwards."
      footer={<>Already have one? <Link to="/login" className="text-indigo-300 hover:text-indigo-200">Sign in</Link></>}
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
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          note={tooShort ? "Eight characters at least." : undefined}
          tone="warn"
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
        <AuthButton type="submit" disabled={!ready} pending={create.isPending} icon={<UserPlus size={15} />}>
          Create account
        </AuthButton>
      </form>

      {create.error && <p className="mt-3 text-sm text-red-400">{create.error.message}</p>}
    </AuthShell>
  );
}
