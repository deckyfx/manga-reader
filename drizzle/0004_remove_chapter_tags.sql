-- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
CREATE TABLE `chapters_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);

-- Copy data from old table
INSERT INTO `chapters_new` SELECT `id`, `series_id`, `title`, `slug`, `created_at` FROM `chapters`;

-- Drop old table
DROP TABLE `chapters`;

-- Rename new table
ALTER TABLE `chapters_new` RENAME TO `chapters`;

-- Create unique index for slug within series
CREATE UNIQUE INDEX `chapters_series_slug_unique` ON `chapters` (`series_id`, `slug`);
