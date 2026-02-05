import { Elysia } from "elysia";
import { healthApi } from "./api/health";
import { seriesApi } from "./api/series";
import { chaptersApi } from "./api/chapters";
import { pagesApi } from "./api/pages";
import { captionsApi, ocrApi } from "./api/captions";

/**
 * Main API routes plugin with /api prefix
 *
 * Composes all domain-specific API plugins:
 * - Health API: /api/health
 * - Series API: /api/series/*
 * - Chapters API: /api/chapters/*
 * - Pages API: /api/pages/*
 * - Captions API: /api/captions/*
 * - OCR API: /api/ocr/*
 */
export const apiPlugin = new Elysia({ prefix: "/api" })
  .use(healthApi)
  .use(seriesApi)
  .use(chaptersApi)
  .use(pagesApi)
  .use(captionsApi)
  .use(ocrApi);
