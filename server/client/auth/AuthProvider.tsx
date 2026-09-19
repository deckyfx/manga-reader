import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getMe, logout as logoutRequest, type Account, type SecondFactor, type UserRole } from "../api";

interface AuthState {
  /** The signed-in account, or null for a guest (who may still read). */
  account: Account | null;
  /** What guards this account: an authenticator app, a passkey, or neither. */
  factors: SecondFactor[];
  /** True while the server has no accounts at all and is waiting for its first admin. */
  needsSetup: boolean;
  /**
   * Set when the server couldn't be asked who you are — a restart, a dropped connection. That is not the same as
   * being a guest, and a page that guards itself must say so rather than bounce to the sign-in screen.
   */
  error: Error | null;
  retry: () => Promise<void>;
  /** Whether anyone may create their own account, which an admin controls. */
  registrationEnabled: boolean;
  loading: boolean;
  /** Whether the account is at least this role; guests are below all of them. */
  can: (role: UserRole) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const RANK: Record<UserRole, number> = { reader: 1, contributor: 2, admin: 3 };

const AuthContext = createContext<AuthState | null>(null);

/**
 * Who is signed in, for the whole client. The server decides everything that matters — this only drives what the UI
 * offers, so a guest isn't shown doors that would answer 401.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 30_000,
    // A 401 here is the answer ("you are a guest"), so it is never retried; anything else is worth one more go
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 401) && attempt < 2,
  });

  const refresh = useCallback(async () => {
    // Waits for the answer (invalidating refetches the mounted query and settles once it has), so a caller acts on
    // what comes back rather than on what was cached
    await qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);

  const signOut = useCallback(async () => {
    await logoutRequest();
    // Everything on screen was fetched as somebody: start again as a guest. `["me"]` is reset rather than removed, so
    // the observer above (still mounted) is handed the guest answer instead of keeping the old account.
    qc.getMutationCache().clear();
    qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
    await qc.resetQueries({ queryKey: ["me"], exact: true });
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    // A 401 means signed out now, whatever an earlier answer still cached says
    const signedOut = meQ.error instanceof ApiError && meQ.error.status === 401;
    const account = signedOut ? null : (meQ.data?.user ?? null);
    return {
      account,
      factors: signedOut ? [] : ((meQ.data?.factors ?? []) as SecondFactor[]),
      needsSetup: meQ.data?.needs_setup ?? false,
      registrationEnabled: meQ.data?.registration_enabled ?? false,
      loading: meQ.isLoading,
      // A 401 is the guest answer (see `retry` above), not a failure to ask
      error: meQ.isError && !signedOut ? (meQ.error as Error) : null,
      retry: refresh,
      can: (role) => (account ? RANK[account.role as UserRole] >= RANK[role] : false),
      refresh,
      signOut,
    };
  }, [meQ.data, meQ.isLoading, meQ.isError, meQ.error, refresh, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}
