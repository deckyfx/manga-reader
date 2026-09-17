-- bubble_index has been NOT NULL since migration 0000; dedup covers all rows
DELETE FROM `page_translation_logs` WHERE rowid IN (
  SELECT rowid FROM (
    SELECT rowid,
      ROW_NUMBER() OVER (
        PARTITION BY job_id, bubble_index
        ORDER BY
          (source_text IS NOT NULL) + (translated_text IS NOT NULL) +
          (inpainted_image_path IS NOT NULL) + (patch_image_path IS NOT NULL) DESC,
          updated_at DESC,
          rowid ASC
      ) rn
    FROM `page_translation_logs`
  ) WHERE rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `page_translation_logs_job_bubble_idx` ON `page_translation_logs` (`job_id`,`bubble_index`);