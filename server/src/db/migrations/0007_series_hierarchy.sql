CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`synopsis` text,
	`cover_path` text,
	`author` text,
	`status` text DEFAULT 'ongoing' NOT NULL,
	`reading_direction` text DEFAULT 'rtl' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `series_tags` (
	`series_id` integer NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_tags_series_tag_idx` ON `series_tags` (`series_id`,`tag`);--> statement-breakpoint
CREATE INDEX `series_tags_tag_idx` ON `series_tags` (`tag`);--> statement-breakpoint
INSERT INTO `series` ("title", "reading_direction", "created_at", "updated_at") SELECT "title", "reading_direction", "created_at", "updated_at" FROM `volumes` ORDER BY "id";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_volumes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`title` text NOT NULL,
	`number` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`cover_path` text,
	`reading_direction` text DEFAULT 'rtl' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_volumes`("id", "series_id", "title", "number", "sort_order", "cover_path", "reading_direction", "created_at", "updated_at") SELECT `v`.`id`, `s`.`id`, `v`.`title`, NULL, 1, `v`.`cover_path`, `v`.`reading_direction`, `v`.`created_at`, `v`.`updated_at` FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY `id`) AS `rn` FROM `volumes`) `v` JOIN (SELECT `id`, ROW_NUMBER() OVER (ORDER BY `id`) AS `rn` FROM `series`) `s` ON `s`.`rn` = `v`.`rn`;--> statement-breakpoint
DROP TABLE `volumes`;--> statement-breakpoint
ALTER TABLE `__new_volumes` RENAME TO `volumes`;--> statement-breakpoint
CREATE INDEX `volumes_series_sort_idx` ON `volumes` (`series_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`volume_id` integer,
	`title` text NOT NULL,
	`number` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`volume_id`) REFERENCES `volumes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_chapters`("id", "series_id", "volume_id", "title", "number", "sort_order", "created_at", "updated_at") SELECT `c`.`id`, (SELECT `v`.`series_id` FROM `volumes` `v` WHERE `v`.`id` = `c`.`volume_id`), `c`.`volume_id`, `c`.`title`, NULL, `c`.`sort_order`, `c`.`created_at`, `c`.`updated_at` FROM `chapters` `c`;--> statement-breakpoint
DROP TABLE `chapters`;--> statement-breakpoint
ALTER TABLE `__new_chapters` RENAME TO `chapters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `chapters_series_sort_idx` ON `chapters` (`series_id`,`sort_order`);
