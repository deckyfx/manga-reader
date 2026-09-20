CREATE TABLE `series_covers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`path` text NOT NULL,
	`label` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_covers_series_idx` ON `series_covers` (`series_id`,`id`);--> statement-breakpoint
ALTER TABLE `series` ADD `cover_id` integer;--> statement-breakpoint
--- The cover each series already had becomes its first cover row, and stays the one shown: pinning it keeps every
--- library looking exactly as it did before this migration. `series.cover_path` is left in place, unread, so this
--- migration can be reasoned about (and reversed by hand) after the fact.
INSERT INTO `series_covers` (`series_id`, `path`, `created_at`)
SELECT `id`, `cover_path`, `created_at` FROM `series` WHERE `cover_path` IS NOT NULL AND `cover_path` <> '';--> statement-breakpoint
UPDATE `series` SET `cover_id` = (
	SELECT `id` FROM `series_covers` WHERE `series_covers`.`series_id` = `series`.`id` ORDER BY `id` DESC LIMIT 1
) WHERE `cover_path` IS NOT NULL AND `cover_path` <> '';
