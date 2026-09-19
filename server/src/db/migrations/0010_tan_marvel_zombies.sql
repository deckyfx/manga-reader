CREATE TABLE `totp_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`secret` text NOT NULL,
	`confirmed_at` text,
	`last_used_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `totp_devices_user_idx` ON `totp_devices` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `totp_secret`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `totp_enabled_at`;