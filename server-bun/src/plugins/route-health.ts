import Elysia, { t } from "elysia";
import { bootState } from "@/boot-state";

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
  }),
  { response: { 200: HealthSchema } },
);
