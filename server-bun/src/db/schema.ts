import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── OCR / Translate logs (mirrors C# OcrLog / TranslateLog) ────────────────

export const ocrLogs = sqliteTable("ocr_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  imageHash: text("image_hash").notNull(),
  sourceText: text("source_text").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  modelRepo: text("model_repo").notNull(),
  processingTimeMs: integer("processing_time_ms"),
});

export const translateLogs = sqliteTable("translate_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceText: text("source_text").notNull(),
  translatedText: text("translated_text").notNull(),
  sourceLang: text("source_lang").notNull().default("ja"),
  targetLang: text("target_lang").notNull().default("en"),
  engine: text("engine").notNull().default("local"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  processingTimeMs: integer("processing_time_ms"),
});

// ── Manga library ────────────────────────────────────────────────────────────

export const volumes = sqliteTable("volumes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  coverPath: text("cover_path"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const chapters = sqliteTable("chapters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  volumeId: integer("volume_id").notNull().references(() => volumes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  pagesDir: text("pages_dir").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ── Studio page-translation pipeline ────────────────────────────────────────

export const pageTranslationJobs = sqliteTable("page_translation_jobs", {
  id: text("id").primaryKey(),
  imageHash: text("image_hash").notNull().unique(),
  /** Original image path or URL */
  sourcePath: text("source_path").notNull(),
  status: text("status").notNull().default("pending"),
  totalBubbles: integer("total_bubbles").notNull().default(0),
  processedBubbles: integer("processed_bubbles").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  errorMessage: text("error_message"),
  /** Serialised TextSeg blocks (JSON) */
  textSegBlocks: text("text_seg_blocks"),
  inpaintEnabled: integer("inpaint_enabled", { mode: "boolean" }).notNull().default(false),
  bubbleEnabled: integer("bubble_enabled", { mode: "boolean" }).notNull().default(false),
});

export const pageTranslationLogs = sqliteTable("page_translation_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: text("job_id")
    .notNull()
    .references(() => pageTranslationJobs.id, { onDelete: "cascade" }),
  bubbleIndex: integer("bubble_index").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  width: real("width").notNull(),
  height: real("height").notNull(),
  rotation: real("rotation").notNull().default(0),
  sourceText: text("source_text"),
  translatedText: text("translated_text"),
  ocrLogId: integer("ocr_log_id").references(() => ocrLogs.id),
  translateLogId: integer("translate_log_id").references(() => translateLogs.id),
  inpaintedImagePath: text("inpainted_image_path"),
  patchImagePath: text("patch_image_path"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  /** Serialised style JSON (font size, color, alignment …) */
  styleJson: text("style_json"),
}, (table) => ({
  bubbleJobIdx: uniqueIndex("page_translation_logs_job_bubble_idx").on(table.jobId, table.bubbleIndex),
}));

// ── Studio pages (stage state per page) ─────────────────────────────────────

/** One manga page; stage images live in data/jobs/<id>/, everything else is here. */
export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  imageHash: text("image_hash").notNull().unique(),
  /** Where the page came from ("upload" or the page URL). */
  source: text("source").notNull(),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  /** queued | running | done | error */
  status: text("status").notNull().default("queued"),
  errorMessage: text("error_message"),
  /** clean_sfx option the last full run used, so cached results are only reused for the same options. */
  cleanSfx: integer("clean_sfx", { mode: "boolean" }).notNull().default(false),
  /** Bumped on every publish so open extension tabs reload the result. */
  revision: integer("revision").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const pageStages = sqliteTable("page_stages", {
  pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  /** detect | ocr | translate | clean_text | clean_sfx | render */
  stage: text("stage").notNull(),
  /** fresh | stale | error */
  status: text("status").notNull(),
  /** Output image inside the page folder, if the stage produces one. */
  file: text("file"),
  errorMessage: text("error_message"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  pageStageIdx: uniqueIndex("page_stages_page_stage_idx").on(table.pageId, table.stage),
}));

export const pageBlocks = sqliteTable("page_blocks", {
  pageId: text("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  /** Block number within the page (1-based, as shown on overlays). */
  idx: integer("idx").notNull(),
  /** text | sfx */
  kind: text("kind").notNull(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  w: integer("w").notNull(),
  h: integer("h").notNull(),
  include: integer("include", { mode: "boolean" }).notNull().default(true),
  sourceText: text("source_text"),
  translatedText: text("translated_text"),
  /** Typeset result JSON (font size, lines, area, fits) from the last render. */
  renderJson: text("render_json"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  pageBlockIdx: uniqueIndex("page_blocks_page_idx_idx").on(table.pageId, table.idx),
}));

// ── Type exports ─────────────────────────────────────────────────────────────

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;

export type PageStageRow = typeof pageStages.$inferSelect;

export type PageBlockRow = typeof pageBlocks.$inferSelect;
export type NewPageBlockRow = typeof pageBlocks.$inferInsert;

export type OcrLog = typeof ocrLogs.$inferSelect;
export type NewOcrLog = typeof ocrLogs.$inferInsert;

export type TranslateLog = typeof translateLogs.$inferSelect;
export type NewTranslateLog = typeof translateLogs.$inferInsert;

export type Volume = typeof volumes.$inferSelect;
export type NewVolume = typeof volumes.$inferInsert;

export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;

export type PageTranslationJob = typeof pageTranslationJobs.$inferSelect;
export type NewPageTranslationJob = typeof pageTranslationJobs.$inferInsert;

export type PageTranslationLog = typeof pageTranslationLogs.$inferSelect;
export type NewPageTranslationLog = typeof pageTranslationLogs.$inferInsert;
