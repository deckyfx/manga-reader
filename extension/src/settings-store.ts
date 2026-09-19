/**
 * Where settings live.
 *
 * `chrome.storage.sync` is copied to Google's servers and to every browser signed into the same profile, which is
 * fine for a language choice and wrong for a credential. The two secrets (the server's API key and the DeepL key) are
 * kept in `chrome.storage.local`, which stays on this machine, and so is everything that decides where the server key
 * goes: the server URL and the consent to send it over plain http. Were those synced, another browser changing the
 * URL would have this one hand its key to the new address unasked.
 *
 * Anything an older build saved into sync is moved across on first read and removed from sync.
 */
import { DEFAULT_SETTINGS, type Settings } from "./types";

/** Settings that never leave this machine. */
const LOCAL_KEYS = ["serverApiKey", "deeplApiKey", "serverUrl", "allowInsecureServer"] as const;
type LocalKey = (typeof LOCAL_KEYS)[number];

const isLocal = (key: string): key is LocalKey => (LOCAL_KEYS as readonly string[]).includes(key);

/** Every setting, with anything an older build left in sync pulled across. */
export async function loadSettings(): Promise<Settings> {
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(keys) as Promise<Partial<Settings>>,
    chrome.storage.local.get([...LOCAL_KEYS]) as Promise<Partial<Settings>>,
  ]);

  // Anything an older build left in sync comes out of sync, whether or not it is still needed here
  const inSync = LOCAL_KEYS.filter((key) => Object.hasOwn(synced, key));
  if (inSync.length > 0) {
    // Only keys this machine has never stored: an empty local value is a key the user cleared, not one to restore
    const rescued = Object.fromEntries(inSync.filter((key) => !Object.hasOwn(local, key)).map((key) => [key, synced[key]]));
    if (Object.keys(rescued).length > 0) {
      await chrome.storage.local.set(rescued);
      Object.assign(local, rescued);
    }
    // Only once the values are safely local: a failed set would otherwise lose them
    await chrome.storage.sync.remove([...inSync]);
  }

  const shared = Object.fromEntries(Object.entries(synced).filter(([key]) => !isLocal(key)));
  return { ...DEFAULT_SETTINGS, ...shared, ...local } as Settings;
}

/** Saves everything, sending the machine-local settings to local storage and the rest to sync. */
export async function saveSettings(settings: Settings): Promise<void> {
  const local: Record<string, unknown> = {};
  const shared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (isLocal(key)) local[key] = value;
    else shared[key] = value;
  }
  await Promise.all([chrome.storage.local.set(local), chrome.storage.sync.set(shared)]);
  // Older builds may still have them in sync; drop that copy only once the local write has landed
  await chrome.storage.sync.remove([...LOCAL_KEYS]);
}

/** Just the pieces the content script needs to talk to the server. */
export async function loadServerAccess(): Promise<{ serverUrl: string; apiKey: string; cleanSfx: boolean }> {
  const settings = await loadSettings();
  return {
    serverUrl: settings.serverUrl.replace(/\/$/, ""),
    apiKey: usableApiKey(settings),
    cleanSfx: settings.pageCleanSfx,
  };
}

/**
 * Whether this address would put the key on a network in clear. Loopback never leaves the machine, https is
 * encrypted; anything else is a home LAN or worse, and the key is only sent there on purpose.
 */
export function isPlainHttpOverNetwork(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:") return false;
    const host = url.hostname;
    return !(host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost"));
  } catch {
    return false;
  }
}

/**
 * The key to send, which is nothing when it would travel in clear and that hasn't been allowed. The server then
 * refuses the request, which is the honest outcome: better a refusal you can read than a credential on the wire.
 */
export function usableApiKey(settings: Pick<Settings, "serverUrl" | "serverApiKey" | "allowInsecureServer">): string {
  if (!settings.serverApiKey) return "";
  if (isPlainHttpOverNetwork(settings.serverUrl) && !settings.allowInsecureServer) return "";
  return settings.serverApiKey;
}
