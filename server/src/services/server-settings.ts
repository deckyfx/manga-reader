/**
 * Settings an admin changes at runtime, kept in the database so they survive a restart.
 *
 * Only policy lives here — things that are a decision rather than a deployment detail. Where the server binds, which
 * models to load and where the database is stay in the environment.
 */
import { childLogger } from "@/lib/logger";
import { ServerSettingStore } from "@/stores/settings-store";


/**
 * What a self-registered account may start as. Admin is deliberately not here: registration is open to strangers
 * when it is on at all, and "everyone who signs up runs the server" is never a setting worth offering.
 */
export const REGISTRATION_ROLES = ["contributor", "reader"] as const;

const log = childLogger("settings");

export type RegistrationRole = (typeof REGISTRATION_ROLES)[number];

export interface ServerPolicy {
  /** Whether anybody may create their own account. Off by default: an admin hands out accounts. */
  registrationEnabled: boolean;
  /** What a self-registered account starts as; never an admin. */
  defaultRole: RegistrationRole;
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
    // A row saying "admin" — from an older build, or an edited database — is read as the default rather than obeyed
    defaultRole: (REGISTRATION_ROLES as readonly string[]).includes(role ?? "") ? (role as RegistrationRole) : DEFAULTS.defaultRole,
  };
  return cache;
}

export async function updateServerPolicy(changes: Partial<ServerPolicy>): Promise<ServerPolicy> {
  const entries: Record<string, string> = {};
  if (changes.registrationEnabled !== undefined) entries.registration_enabled = String(changes.registrationEnabled);
  if (changes.defaultRole !== undefined) entries.default_role = changes.defaultRole;
  try {
    // One transaction, so a failure can't leave half a policy behind to be read after the next reload
    await ServerSettingStore.setMany(entries);
  } finally {
    cache = null;
  }
  const policy = await serverPolicy();
  log.info({ ...policy }, "Server policy changed");
  return policy;
}
