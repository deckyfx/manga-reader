CREATE TABLE `__new_chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`volume_id` integer NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`pages_dir` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`volume_id`) REFERENCES `volumes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Rescue any chapters orphaned by NULL volume_id: assign them to a new "Unassigned" volume
INSERT INTO `volumes` (`title`, `created_at`, `updated_at`)
  SELECT 'Unassigned', datetime('now'), datetime('now')
  WHERE EXISTS (SELECT 1 FROM `chapters` WHERE `volume_id` IS NULL);--> statement-breakpoint
UPDATE `chapters` SET `volume_id` = (
  SELECT `id` FROM `volumes` WHERE `title` = 'Unassigned' ORDER BY `id` DESC LIMIT 1
) WHERE `volume_id` IS NULL;--> statement-breakpoint
INSERT INTO `__new_chapters`("id", "volume_id", "title", "sort_order", "pages_dir", "created_at", "updated_at") SELECT "id", "volume_id", "title", "sort_order", "pages_dir", "created_at", "updated_at" FROM `chapters`;--> statement-breakpoint
DROP TABLE `chapters`;--> statement-breakpoint
ALTER TABLE `__new_chapters` RENAME TO `chapters`;--> statement-breakpoint
DELETE FROM `page_translation_jobs` WHERE rowid IN (
  SELECT rowid FROM (
    SELECT rowid,
      ROW_NUMBER() OVER (
        PARTITION BY image_hash
        ORDER BY
          (text_seg_blocks IS NOT NULL) DESC,
          updated_at DESC,
          rowid ASC
      ) rn
    FROM `page_translation_jobs`
  ) WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `page_translation_jobs_image_hash_unique` ON `page_translation_jobs` (`image_hash`);