import { eq, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { serverSettings } from "@/db/schema";
import { env } from "@/env";

/** Runtime-mutable settings; initialized from env vars, survives until process restart. */
export const runtimeSettings: {
  preferredTranslationEngine: "auto" | "local" | "deepl";
  inpaintEngine: "auto" | "lama" | "flood_fill";
} = {
  preferredTranslationEngine: env.PREFERRED_TRANSLATION_ENGINE,
  inpaintEngine: env.INPAINT_ENGINE,
};

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
