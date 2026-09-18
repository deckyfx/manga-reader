import Elysia, { t } from "elysia";
import { bootState } from "@/boot-state";
import pkg from "../../package.json" with { type: "json" };

/** Read once: it can't change while the process runs. */
const VERSION = {
  server: (pkg as { version: string }).version,
  bun: Bun.version,
  started_at: new Date().toISOString(),
};

const HealthSchema = t.Object({
  status: t.Union([t.Literal("starting"), t.Literal("ready"), t.Literal("degraded")]),
  ocr: t.Boolean(),
  translate: t.Boolean(),
  dictionary: t.Boolean(),
  inpaint: t.Union([t.Boolean(), t.Literal("disabled")]),
  bubble: t.Union([t.Boolean(), t.Literal("disabled")]),
  text_seg: t.Union([t.Boolean(), t.Literal("disabled")]),
  /** Active downloads: label → 0-100 (percent), or -1 when size unknown. Empty when nothing downloading. */
  downloads: t.Record(t.String(), t.Integer()),
  /** What is running here: the server's own version, the Bun it runs on, and when it came up. */
  version: t.Object({ server: t.String(), bun: t.String(), started_at: t.String() }),
});

export const routeHealth = new Elysia({ prefix: "/health" }).get(
  "/",
  () => ({
    status: bootState.healthStatus,
    ocr: bootState.ocrReady,
    translate: bootState.translateReady,
    dictionary: bootState.dictionaryReady,
    inpaint: bootState.inpaintEnabled ? bootState.inpaintReady : ("disabled" as const),
    bubble: bootState.bubbleEnabled ? bootState.bubbleReady : ("disabled" as const),
    text_seg: bootState.textSegEnabled ? bootState.textSegReady : ("disabled" as const),
    downloads: bootState.activeDownloads,
    version: VERSION,
  }),
  { response: { 200: HealthSchema } },
);
