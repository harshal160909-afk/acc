CREATE TABLE `accounting_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`date` text NOT NULL,
	`source` text NOT NULL,
	`amount` integer NOT NULL,
	`debit` text NOT NULL,
	`credit` text NOT NULL,
	`kind` text NOT NULL,
	`settlement` text NOT NULL,
	`source_file` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_entries_owner_created_idx` ON `accounting_entries` (`owner_key`,`created_at`);