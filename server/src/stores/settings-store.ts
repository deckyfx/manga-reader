import { env } from "@/env";

/** Runtime-mutable settings; initialized from env vars, survives until process restart. */
export const runtimeSettings: {
  preferredTranslationEngine: "auto" | "local" | "deepl";
  inpaintEngine: "auto" | "lama" | "flood_fill";
} = {
  preferredTranslationEngine: env.PREFERRED_TRANSLATION_ENGINE,
  inpaintEngine: env.INPAINT_ENGINE,
};
