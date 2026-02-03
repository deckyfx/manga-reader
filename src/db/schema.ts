import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Series table - stores manga series information
 */
export const series = sqliteTable("series", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").unique(), // Auto-generated: s00001, s00002, etc.
  title: text("title").notNull(),
  synopsis: text("synopsis"),
  coverArt: text("cover_art"),
  tags: text("tags"), // JSON string of tags array
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Chapters table - stores manga chapter information
 */
export const chapters = sqliteTable("chapters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").unique(), // Auto-generated: c00001, c00002, etc.
  seriesId: integer("series_id")
    .notNull()
    .references(() => series.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  chapterNumber: text("chapter_number").notNull(), // User-provided: "1", "2", "1.5"
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Pages table - stores manga page information
 */
export const pages = sqliteTable("pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").unique(), // Auto-generated: p00001, p00002, etc.
  chapterId: integer("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  originalImage: text("original_image").notNull(),
  orderNum: integer("order_num").notNull(), // Page order within chapter
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * User Captions table - stores OCR and translation results for manga bubbles
 */
export const userCaptions = sqliteTable("user_captions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").unique(), // Auto-generated: u00001, u00002, etc.
  pageId: integer("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),

  // Position coordinates
  x: integer("x").notNull(),
  y: integer("y").notNull(),

  // Dimensions
  width: integer("width").notNull(),
  height: integer("height").notNull(),

  // Image data (base64 encoded)
  capturedImage: text("captured_image").notNull(),

  // Text data
  rawText: text("raw_text").notNull(),
  translatedText: text("translated_text"),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});

// Type exports for TypeScript
export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type UserCaption = typeof userCaptions.$inferSelect;
export type NewUserCaption = typeof userCaptions.$inferInsert;
