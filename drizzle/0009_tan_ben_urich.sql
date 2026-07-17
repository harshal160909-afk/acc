CREATE TABLE `bank_statement_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`file_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_import_workspace_hash_idx` ON `bank_statement_imports` (`workspace_id`,`file_hash`);--> statement-breakpoint
CREATE TABLE `bank_statement_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`transaction_date` text NOT NULL,
	`description` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`direction` text NOT NULL,
	`matched_entry_id` text,
	`match_status` text DEFAULT 'unmatched' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_lines_workspace_date_idx` ON `bank_statement_lines` (`workspace_id`,`transaction_date`);--> statement-breakpoint
CREATE TABLE `fixed_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`acquisition_date` text NOT NULL,
	`cost_paise` integer NOT NULL,
	`accumulated_depreciation_paise` integer DEFAULT 0 NOT NULL,
	`method` text DEFAULT 'manual' NOT NULL,
	`useful_life_months` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`unit` text DEFAULT 'unit' NOT NULL,
	`quantity_micros` integer DEFAULT 0 NOT NULL,
	`cost_paise` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_workspace_sku_idx` ON `inventory_items` (`workspace_id`,`sku`);--> statement-breakpoint
CREATE TABLE `period_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`unlocked_at` integer
);
--> statement-breakpoint
CREATE INDEX `period_locks_workspace_dates_idx` ON `period_locks` (`workspace_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `privacy_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id_hash` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL
);
