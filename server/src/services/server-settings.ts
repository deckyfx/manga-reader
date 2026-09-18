/**
 * Settings an admin changes at runtime, kept in the database so they survive a restart.
 *
 * Only policy lives here — things that are a decision rather than a deployment detail. Where the server binds, which
 * models to load and where the database is stay in the environment.
 */
import { childLogger } from "@/lib/logger";
import { ServerSettingStore } from "@/stores/settings-store";
import { USER_ROLES, type UserRole } from "@/db/schema";

const log = childLogger("settings");

export interface ServerPolicy {
  /** Whether anybody may create their own account. Off by default: an admin hands out accounts. */
  registrationEnabled: boolean;
  /** What a self-registered account starts as. */
  defaultRole: UserRole;
}

const DEFAULTS: ServerPolicy = { registrationEnabled: false, defaultRole: "reader" };

/** Read often (every sign-in screen asks), written rarely: cached until something changes it. */
let cache: ServerPolicy | null = null;

export async function serverPolicy(): Promise<ServerPolicy> {
  if (cache) return cache;
  const stored = await ServerSettingStore.all();
  const role = stored.get("default_role");
  cache = {
    registrationEnabled: stored.get("registration_enabled") === "true",
    defaultRole: (USER_ROLES as readonly string[]).includes(role ?? "") ? (role as UserRole) : DEFAULTS.defaultRole,
  };
  return cache;
}

export async function updateServerPolicy(changes: Partial<ServerPolicy>): Promise<ServerPolicy> {
  if (changes.registrationEnabled !== undefined) {
    await ServerSettingStore.set("registration_enabled", String(changes.registrationEnabled));
  }
  if (changes.defaultRole !== undefined) await ServerSettingStore.set("default_role", changes.defaultRole);
  cache = null;
  const policy = await serverPolicy();
  log.info({ ...policy }, "Server policy changed");
  return policy;
}
