CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`volume_id` integer,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`pages_dir` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`volume_id`) REFERENCES `volumes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ocr_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_hash` text NOT NULL,
	`source_text` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`model_repo` text NOT NULL,
	`processing_time_ms` integer
);
--> statement-breakpoint
CREATE TABLE `page_translation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`image_hash` text NOT NULL,
	`source_path` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_bubbles` integer DEFAULT 0 NOT NULL,
	`processed_bubbles` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`error_message` text,
	`text_seg_blocks` text,
	`inpaint_enabled` integer DEFAULT false NOT NULL,
	`bubble_enabled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `page_translation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`bubble_index` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`rotation` real DEFAULT 0 NOT NULL,
	`source_text` text,
	`translated_text` text,
	`ocr_log_id` integer,
	`translate_log_id` integer,
	`inpainted_image_path` text,
	`patch_image_path` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`style_json` text,
	FOREIGN KEY (`job_id`) REFERENCES `page_translation_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ocr_log_id`) REFERENCES `ocr_logs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`translate_log_id`) REFERENCES `translate_logs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `translate_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_text` text NOT NULL,
	`translated_text` text NOT NULL,
	`source_lang` text DEFAULT 'ja' NOT NULL,
	`target_lang` text DEFAULT 'en' NOT NULL,
	`engine` text DEFAULT 'local' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`processing_time_ms` integer
);
--> statement-breakpoint
CREATE TABLE `volumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`cover_path` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
