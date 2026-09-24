/**
 * Which translator a request ends up on.
 *
 * Its own module so the HTTP route can ask without pulling in onnxruntime: the answer decides between somebody
 * else's server (Sugoi, DeepL) and the built-in model, and only the last of those needs the runtime loaded.
 */
import { env } from "@/env";
import { runtimeSettings } from "@/stores/settings-store";

/** The engines that can actually translate something, in the order `auto` reaches for them. */
export type TranslationEngine = "sugoi" | "deepl" | "local";

/**
 * What the request asked for when that engine is configured, otherwise the runtime setting, otherwise whatever is
 * there. A request for an engine nobody set up falls through rather than failing — a page still gets translated,
 * just not by the engine that isn't there.
 */
export function resolveTranslationEngine(requested?: string): TranslationEngine {
  const available = { sugoi: !!env.SUGOI_URL, deepl: !!env.DEEPL_API_KEY, local: true } as const;
  const asked = requested?.toLowerCase();
  const wanted = asked && asked !== "auto" ? asked : runtimeSettings.preferredTranslationEngine;
  if (wanted === "local") return "local";
  if ((wanted === "sugoi" || wanted === "deepl") && available[wanted]) return wanted;
  return available.sugoi ? "sugoi" : available.deepl ? "deepl" : "local";
}
