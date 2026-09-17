DROP INDEX `pages_image_hash_unique`;--> statement-breakpoint
ALTER TABLE `pages` ADD `chapter_id` integer REFERENCES chapters(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `name` text;--> statement-breakpoint
CREATE INDEX `pages_image_hash_idx` ON `pages` (`image_hash`);--> statement-breakpoint
CREATE INDEX `pages_chapter_sort_idx` ON `pages` (`chapter_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `volumes` ADD `reading_direction` text DEFAULT 'rtl' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` DROP COLUMN `pages_dir`;