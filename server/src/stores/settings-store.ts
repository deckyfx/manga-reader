import { eq, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { serverSettings } from "@/db/schema";
import { env } from "@/env";

/** The engines a request may ask for, and the ones an admin may choose between. */
export const TRANSLATION_ENGINES = ["auto", "local", "deepl", "sugoi"] as const;
export const INPAINT_ENGINES = ["auto", "lama", "flood_fill"] as const;

/**
 * Which engines this server uses. The environment sets what they start as; an admin can change them while it runs,
 * and that choice is remembered (see loadRuntimeSettings).
 */
export const runtimeSettings: {
  preferredTranslationEngine: (typeof TRANSLATION_ENGINES)[number];
  inpaintEngine: (typeof INPAINT_ENGINES)[number];
} = {
  preferredTranslationEngine: env.PREFERRED_TRANSLATION_ENGINE,
  inpaintEngine: env.INPAINT_ENGINE,
};

/** Where each choice is kept, so a restart doesn't quietly undo it. */
const ENGINE_KEYS = { translation: "translation_engine", inpaint: "inpaint_engine" } as const;

/**
 * Takes back the engine choices an admin made, at boot. A stored value that is no longer one of the choices — an
 * older build's, or an edited database — is ignored in favour of the environment's.
 */
export async function loadRuntimeSettings(): Promise<void> {
  const stored = await ServerSettingStore.all();
  const translation = stored.get(ENGINE_KEYS.translation);
  const inpaint = stored.get(ENGINE_KEYS.inpaint);
  if (TRANSLATION_ENGINES.includes(translation as (typeof TRANSLATION_ENGINES)[number]))
    runtimeSettings.preferredTranslationEngine = translation as (typeof TRANSLATION_ENGINES)[number];
  if (INPAINT_ENGINES.includes(inpaint as (typeof INPAINT_ENGINES)[number]))
    runtimeSettings.inpaintEngine = inpaint as (typeof INPAINT_ENGINES)[number];
}

/**
 * Changes an engine and remembers it. It is written down before it takes effect, so a failed write can't leave the
 * running server on an engine the next restart won't know about — and an engine that isn't one of that setting's
 * choices ("lama" for translation, say) changes nothing.
 */
export async function setRuntimeEngine(which: keyof typeof ENGINE_KEYS, engine: string): Promise<void> {
  const choices: readonly string[] = which === "translation" ? TRANSLATION_ENGINES : INPAINT_ENGINES;
  if (!choices.includes(engine)) throw new Error(`${engine} is not one of: ${choices.join(", ")}`);
  await ServerSettingStore.set(ENGINE_KEYS[which], engine);
  if (which === "translation") runtimeSettings.preferredTranslationEngine = engine as (typeof TRANSLATION_ENGINES)[number];
  else runtimeSettings.inpaintEngine = engine as (typeof INPAINT_ENGINES)[number];
}

/** The key/value table behind the runtime policy an admin can change (see services/server-settings.ts). */
export class ServerSettingStore {
  static async all(): Promise<Map<string, string>> {
    const rows = await db.select().from(serverSettings);
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  static async set(key: string, value: string): Promise<void> {
    await db
      .insert(serverSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: serverSettings.key, set: { value, updatedAt: sql`(datetime('now'))` } });
  }

  /** Writes several settings in one transaction: all of them land, or none do. */
  static async setMany(entries: Record<string, string>): Promise<void> {
    db.transaction((tx) => {
      for (const [key, value] of Object.entries(entries)) {
        tx.insert(serverSettings)
          .values({ key, value })
          .onConflictDoUpdate({ target: serverSettings.key, set: { value, updatedAt: sql`(datetime('now'))` } })
          .run();
      }
    });
  }

  static async get(key: string): Promise<string | undefined> {
    const row = await db.select().from(serverSettings).where(eq(serverSettings.key, key)).get();
    return row?.value;
  }
}
