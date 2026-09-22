ALTER TABLE `pages` ADD `finalized_at` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `raw_deleted` integer DEFAULT false NOT NULL;