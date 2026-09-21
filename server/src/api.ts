import { Elysia } from "elysia";
import { routeHealth } from "@/plugins/route-health";
import { routeOcr } from "@/plugins/route-ocr";
import { routeTranslate } from "@/plugins/route-translate";
import { routeAnalyze } from "@/plugins/route-analyze";
import { routeTools } from "@/plugins/route-tools";
import { routeTranslatePage } from "@/plugins/route-translate-page";
import { routeSettings } from "@/plugins/route-settings";
import { studioPlugin } from "@/plugins/studio/index";
import { managePlugin } from "@/plugins/manage/index";

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

/**
 * The extension also talks to three areas the main app mounts separately: `/api/settings` (which server this is, and
 * what it can do), `/studio/api` (chapter import, through the workspace routes) and `/manage/api` (starting a series
 * from a page). Only their types are exported — nothing is composed here, so no plugin is mounted twice.
 */
export type SettingsApi = typeof routeSettings;
export type StudioApi = typeof studioPlugin;
/** `/manage/api`, for "New series from this page": creating a series and putting a cover on it. */
export type ManageApi = typeof managePlugin;
export type { PageJobEvent } from "@/stores/translation-job-store";
export type { PageLiveEvent } from "@/stores/page-live-channel";
