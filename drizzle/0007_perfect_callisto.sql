CREATE TABLE `auth_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_expires_idx` ON `auth_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `manual_price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`security_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`price_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`observed_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `manual_prices_workspace_security_observed_idx` ON `manual_price_snapshots` (`workspace_id`,`security_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`code_verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`return_to` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `oauth_states_expires_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`route_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_owner_route_window_idx` ON `rate_limit_events` (`owner_key`,`route_key`,`window_start`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_subject` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_subject_idx` ON `users` (`google_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);