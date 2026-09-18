/**
 * Where settings live.
 *
 * `chrome.storage.sync` is copied to Google's servers and to every browser signed into the same profile, which is
 * fine for a server URL or a language choice and wrong for a credential. The two secrets — the server's API key and
 * the DeepL key — are kept in `chrome.storage.local`, which stays on this machine.
 *
 * A key already saved into sync by an older build is moved across on first read and removed from sync.
 */
import { DEFAULT_SETTINGS, type Settings } from "./types";

/** Settings that never leave this machine. */
const SECRET_KEYS = ["serverApiKey", "deeplApiKey"] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

const isSecret = (key: string): key is SecretKey => (SECRET_KEYS as readonly string[]).includes(key);

/** Every setting, secrets included, with anything an older build left in sync pulled across. */
export async function loadSettings(): Promise<Settings> {
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(keys) as Promise<Partial<Settings>>,
    chrome.storage.local.get([...SECRET_KEYS]) as Promise<Partial<Settings>>,
  ]);

  // Anything an older build left in sync comes out of sync, whether or not it is still needed here
  const inSync = SECRET_KEYS.filter((key) => typeof synced[key] === "string" && synced[key] !== "");
  if (inSync.length > 0) {
    const rescued = Object.fromEntries(inSync.filter((key) => !local[key]).map((key) => [key, synced[key]]));
    if (Object.keys(rescued).length > 0) {
      await chrome.storage.local.set(rescued);
      Object.assign(local, rescued);
    }
    // Only once the values are safely local: a failed set would otherwise lose them
    await chrome.storage.sync.remove([...inSync]);
  }

  const publicSettings = Object.fromEntries(Object.entries(synced).filter(([key]) => !isSecret(key)));
  return { ...DEFAULT_SETTINGS, ...publicSettings, ...local } as Settings;
}

/** Saves everything, sending the secrets to local storage and the rest to sync. */
export async function saveSettings(settings: Settings): Promise<void> {
  const secrets: Record<string, string> = {};
  const shared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (isSecret(key)) secrets[key] = String(value);
    else shared[key] = value;
  }
  await Promise.all([
    chrome.storage.local.set(secrets),
    chrome.storage.sync.set(shared),
    // Older builds may still have them in sync; don't leave a copy behind
    chrome.storage.sync.remove([...SECRET_KEYS]),
  ]);
}

/** Just the pieces the content script needs to talk to the server. */
export async function loadServerAccess(): Promise<{ serverUrl: string; apiKey: string; cleanSfx: boolean }> {
  const settings = await loadSettings();
  return {
    serverUrl: settings.serverUrl.replace(/\/$/, ""),
    apiKey: settings.serverApiKey,
    cleanSfx: settings.pageCleanSfx,
  };
}
