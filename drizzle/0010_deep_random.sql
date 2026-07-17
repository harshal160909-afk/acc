-- ACC v10 -> public guest-access migration.
-- 1. Google OAuth is removed, so the transient OAuth state table is dropped.
-- 2. `users` is rebuilt to make google_subject/email nullable and to add the
--    generalized access-session columns. Existing verified rows are preserved
--    and tagged access_mode='google' so no financial records are orphaned.
DROP TABLE IF EXISTS `oauth_states`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_subject` text,
	`email` text,
	`display_name` text DEFAULT 'Guest' NOT NULL,
	`access_mode` text DEFAULT 'guest' NOT NULL,
	`optional_contact_email` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`last_active_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "google_subject", "email", "display_name", "access_mode", "optional_contact_email", "created_at", "updated_at", "deleted_at", "last_active_at") SELECT "id", "google_subject", "email", "display_name", 'google', "email", "created_at", "updated_at", "deleted_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_subject_idx` ON `users` (`google_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);
