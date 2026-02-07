import { Elysia } from "elysia";
import { healthApi } from "./api/health";
import { seriesApi } from "./api/series";
import { chaptersApi } from "./api/chapters";
import { pagesApi } from "./api/pages";
import { studioApi } from "./api/studio";

/**
 * Main API routes plugin with /api prefix
 *
 * Composes all domain-specific API plugins:
 * - Health API: /api/health
 * - Series API: /api/series/*
 * - Chapters API: /api/chapters/*
 * - Pages API: /api/pages/*
 * - Studio API: /api/studio/* (captions, OCR, patches, merge)
 */
export const apiPlugin = new Elysia({ prefix: "/api" })
  .use(healthApi)
  .use(seriesApi)
  .use(chaptersApi)
  .use(pagesApi)
  .use(studioApi);
