import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
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

// ── Library: series → volume (optional) → chapter → page ────────────────────

export const series = sqliteTable("series", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  synopsis: text("synopsis"),
  /** Cover image inside the covers folder; falls back to the first page when unset. */
  coverPath: text("cover_path"),
  author: text("author"),
  /** ongoing | completed | hiatus */
  status: text("status").notNull().default("ongoing"),
  /** How the reader pages through this series: rtl (manga, default) | ltr */
  readingDirection: text("reading_direction").notNull().default("rtl"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

/** Tags of a series, one row each, so searches can include and exclude them without scanning strings. */
export const seriesTags = sqliteTable("series_tags", {
  seriesId: integer("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
}, (table) => ({
  seriesTagIdx: uniqueIndex("series_tags_series_tag_idx").on(table.seriesId, table.tag),
  tagIdx: index("series_tags_tag_idx").on(table.tag),
}));

/** A volume groups chapters of a series; chapters may also sit directly under the series. */
export const volumes = sqliteTable("volumes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  seriesId: integer("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** Volume number as shown ("1", "2"); free text so half volumes work. */
  number: text("number"),
  sortOrder: integer("sort_order").notNull().default(0),
  coverPath: text("cover_path"),
  /** @deprecated moved to the series; dropped in a later migration once no data depends on it. */
  readingDirection: text("reading_direction").notNull().default("rtl"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  volumeSeriesIdx: index("volumes_series_sort_idx").on(table.seriesId, table.sortOrder),
}));

export const chapters = sqliteTable("chapters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  seriesId: integer("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  /** Volume it belongs to, or null when the series has no volumes (or it isn't sorted into one yet). */
  volumeId: integer("volume_id").references(() => volumes.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  /** Chapter number as shown ("1", "1.5"); free text, ordering uses sort_order. */
  number: text("number"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  chapterSeriesIdx: index("chapters_series_sort_idx").on(table.seriesId, table.sortOrder),
}));

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
  /** Not unique: the same image can sit in several chapters. The extension's reuse cache looks up Inbox pages. */
  imageHash: text("image_hash").notNull(),
  /** Chapter this page belongs to; null = Inbox (extension jobs and uploads not filed yet). */
  chapterId: integer("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  /** Reading order inside the chapter. */
  sortOrder: integer("sort_order").notNull().default(0),
  /** Shown in the reader and used for export file names; falls back to the page number. */
  name: text("name"),
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
}, (table) => ({
  pageHashIdx: index("pages_image_hash_idx").on(table.imageHash),
  pageChapterIdx: index("pages_chapter_sort_idx").on(table.chapterId, table.sortOrder),
}));

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
  /** Region shape JSON for ellipse / polygon regions drawn in the Studio; null means a plain rectangle. */
  shapeJson: text("shape_json"),
  /** Lettering style overrides JSON (font, size, colours, alignment, rotation, text box); null means automatic. */
  styleJson: text("style_json"),
  /** Text area JSON from the last render (bound, dark, run-length mask), reused by the Studio's live preview. */
  areaJson: text("area_json"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  pageBlockIdx: uniqueIndex("page_blocks_page_idx_idx").on(table.pageId, table.idx),
}));

// ── Type exports ─────────────────────────────────────────────────────────────

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;

export type PageStageRow = typeof pageStages.$inferSelect;

/**
 * Server-level settings an admin can change at runtime, as key/value text. A table rather than env vars, because a
 * switch flipped in /admin has to survive a restart, and because the values are policy rather than deployment.
 */
export const serverSettings = sqliteTable("server_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ── Accounts ────────────────────────────────────────────────────────────────

/** admin manages people and keys; contributor manages the library and the Studio; reader only reads. */
export const USER_ROLES = ["admin", "contributor", "reader"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Lower-cased on the way in, so names are unique regardless of how they were typed. */
  username: text("username").notNull(),
  displayName: text("display_name"),
  /** Argon2id, from Bun.password. */
  passwordHash: text("password_hash").notNull(),
  /** From Google sign-in, or set by an admin; unique when present. */
  email: text("email"),
  role: text("role").notNull().default("reader"),
  /** Set when the account is suspended: it keeps its work but can't sign in. */
  disabledAt: text("disabled_at"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  usersUsernameIdx: uniqueIndex("users_username_idx").on(table.username),
  usersEmailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

/** Browser sessions. Only the hash of the cookie's token is stored, so the table is useless if it leaks. */
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`(datetime('now'))`),
  expiresAt: text("expires_at").notNull(),
}, (table) => ({
  sessionsUserIdx: index("sessions_user_idx").on(table.userId),
  sessionsExpiryIdx: index("sessions_expiry_idx").on(table.expiresAt),
}));

/**
 * Authenticator apps, one row per device: a phone and a laptop can both hold a code for the same account, each with
 * its own secret, so losing one doesn't mean re-enrolling the other. A device guards nothing until `confirmedAt`.
 */
export const totpDevices = sqliteTable("totp_devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Base32, as the app stores it. */
  secret: text("secret").notNull(),
  confirmedAt: text("confirmed_at"),
  /** The 30-second step this device last signed in with; a code is good once, not for its whole window. */
  lastStep: integer("last_step"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  totpDevicesUserIdx: index("totp_devices_user_idx").on(table.userId),
}));

/** Single-use codes for getting back in when the authenticator is gone. Stored hashed, like every other secret. */
export const recoveryCodes = sqliteTable("recovery_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  recoveryCodesUserIdx: index("recovery_codes_user_idx").on(table.userId),
}));

/**
 * The gap between "the password was right" and "you are signed in", while a second factor is checked. Short-lived,
 * stored hashed, and useless on its own: it can only be exchanged for a session by passing the second step.
 */
export const mfaChallenges = sqliteTable("mfa_challenges", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** WebAuthn assertion challenge, once one has been asked for. */
  webauthnChallenge: text("webauthn_challenge"),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  expiresAt: text("expires_at").notNull(),
});

/** Registered passkeys. Second factor: a passkey confirms a password, it doesn't replace one. */
export const credentials = sqliteTable("credentials", {
  /** The credential id from the authenticator (base64url). */
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull(),
  /** Signature counter, to notice a cloned authenticator. */
  counter: integer("counter").notNull().default(0),
  transports: text("transports"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  credentialsUserIdx: index("credentials_user_idx").on(table.userId),
}));

/** A Google account linked to a user. One row per provider account, so the same Google login always lands here. */
export const oauthAccounts = sqliteTable("oauth_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  email: text("email"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  oauthProviderIdx: uniqueIndex("oauth_provider_account_idx").on(table.provider, table.providerAccountId),
  oauthUserIdx: index("oauth_user_idx").on(table.userId),
}));

/** Keys for the extension and the desktop app (`X-Api-Key`). Stored hashed; the prefix is shown to identify one. */
export const apiKeys = sqliteTable("api_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** First characters of the key, for telling keys apart in the list. */
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  apiKeysHashIdx: uniqueIndex("api_keys_hash_idx").on(table.keyHash),
  apiKeysUserIdx: index("api_keys_user_idx").on(table.userId),
}));

export type PageBlockRow = typeof pageBlocks.$inferSelect;
export type NewPageBlockRow = typeof pageBlocks.$inferInsert;

export type OcrLog = typeof ocrLogs.$inferSelect;
export type NewOcrLog = typeof ocrLogs.$inferInsert;

export type TranslateLog = typeof translateLogs.$inferSelect;
export type NewTranslateLog = typeof translateLogs.$inferInsert;

export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type SeriesTag = typeof seriesTags.$inferSelect;

export type Volume = typeof volumes.$inferSelect;
export type NewVolume = typeof volumes.$inferInsert;

export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;

export type PageTranslationJob = typeof pageTranslationJobs.$inferSelect;
export type NewPageTranslationJob = typeof pageTranslationJobs.$inferInsert;

export type PageTranslationLog = typeof pageTranslationLogs.$inferSelect;
export type NewPageTranslationLog = typeof pageTranslationLogs.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type TotpDevice = typeof totpDevices.$inferSelect;
export type RecoveryCode = typeof recoveryCodes.$inferSelect;
export type MfaChallenge = typeof mfaChallenges.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type OauthAccount = typeof oauthAccounts.$inferSelect;

export type ServerSetting = typeof serverSettings.$inferSelect;
