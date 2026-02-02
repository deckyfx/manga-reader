import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Pages table - stores manga page information
 */
export const pages = sqliteTable("pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalImage: text("original_image").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * User Captions table - stores OCR and translation results for manga bubbles
 */
export const userCaptions = sqliteTable("user_captions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type UserCaption = typeof userCaptions.$inferSelect;
export type NewUserCaption = typeof userCaptions.$inferInsert;
