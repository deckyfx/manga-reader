CREATE TABLE `page_blocks` (
	`page_id` text NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`include` integer DEFAULT true NOT NULL,
	`source_text` text,
	`translated_text` text,
	`render_json` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_blocks_page_idx_idx` ON `page_blocks` (`page_id`,`idx`);--> statement-breakpoint
CREATE TABLE `page_stages` (
	`page_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`file` text,
	`error_message` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_stages_page_stage_idx` ON `page_stages` (`page_id`,`stage`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`image_hash` text NOT NULL,
	`source` text NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_message` text,
	`clean_sfx` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_image_hash_unique` ON `pages` (`image_hash`);