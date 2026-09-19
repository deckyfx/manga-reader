import { Elysia } from "elysia";
import { routeHealth } from "@/plugins/route-health";
import { routeOcr } from "@/plugins/route-ocr";
import { routeTranslate } from "@/plugins/route-translate";
import { routeAnalyze } from "@/plugins/route-analyze";
import { routeTools } from "@/plugins/route-tools";
import { routeTranslatePage } from "@/plugins/route-translate-page";

/**
 * Routes used by the browser extension. `Api` is emitted as declarations (`bun run types:api`) so the
 * extension gets end-to-end types through Eden Treaty without compiling server sources.
 */
export const api = new Elysia()
  .use(routeHealth)
  .use(routeTools)
  .use(routeOcr)
  .use(routeTranslate)
  .use(routeAnalyze)
  .use(routeTranslatePage);

export type Api = typeof api;
export type { PageJobEvent } from "@/stores/translation-job-store";
export type { PageLiveEvent } from "@/stores/page-live-channel";
