CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`chapter_id` integer,
	`created_by` integer,
	`source_url` text,
	`source_provider` text,
	`adult` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workspaces_source_url_idx` ON `workspaces` (`source_url`);--> statement-breakpoint
CREATE INDEX `workspaces_chapter_idx` ON `workspaces` (`chapter_id`);--> statement-breakpoint
ALTER TABLE `pages` ADD `workspace_id` integer REFERENCES workspaces(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `pages` ADD `origin_page_id` text REFERENCES pages(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `pages_workspace_sort_idx` ON `pages` (`workspace_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `pages_origin_idx` ON `pages` (`origin_page_id`);