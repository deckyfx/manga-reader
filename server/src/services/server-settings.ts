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
  /** How long a region scan stays in the activity log. 0 keeps them for ever. */
  scanLogDays: number;
}

/** A year is plenty for an activity log, and it keeps a typo from turning the sweep into a no-op for ever. */
export const MAX_SCAN_LOG_DAYS = 365;

const DEFAULTS: ServerPolicy = { registrationEnabled: false, defaultRole: "reader", scanLogDays: 30 };

/** A stored day count that isn't a whole number in range is read as the default, not obeyed. */
function readScanLogDays(raw: string | undefined): number {
  if (raw === undefined) return DEFAULTS.scanLogDays;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0 || days > MAX_SCAN_LOG_DAYS) return DEFAULTS.scanLogDays;
  return days;
}

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
    scanLogDays: readScanLogDays(stored.get("scan_log_days")),
  };
  return cache;
}

export async function updateServerPolicy(changes: Partial<ServerPolicy>): Promise<ServerPolicy> {
  const entries: Record<string, string> = {};
  if (changes.registrationEnabled !== undefined) entries.registration_enabled = String(changes.registrationEnabled);
  if (changes.defaultRole !== undefined) entries.default_role = changes.defaultRole;
  if (changes.scanLogDays !== undefined) entries.scan_log_days = String(changes.scanLogDays);
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
