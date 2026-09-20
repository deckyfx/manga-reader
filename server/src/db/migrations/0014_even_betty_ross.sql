CREATE TABLE `region_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`api_key_id` integer,
	`username` text NOT NULL,
	`source_text` text NOT NULL,
	`translated_text` text,
	`translate_engine` text DEFAULT 'none' NOT NULL,
	`elapsed_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `region_scans_created_idx` ON `region_scans` (`created_at`);--> statement-breakpoint
CREATE INDEX `region_scans_user_id_idx` ON `region_scans` (`user_id`,`id`);