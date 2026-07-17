ALTER TABLE `accounting_entries` ADD `amount_paise` integer;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `description` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `transaction_type` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `category` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `status` text DEFAULT 'needs_review' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `source_type` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `entry_number` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `provenance` text;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `business_type` text;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `custom_business_type` text;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `legal_structure` text;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `opening_bank_paise` integer;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `cash_in_hand_paise` integer;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `connection_mode` text;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `setup_completed_at` integer;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `profile_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `accounting_entries`
SET
	`amount_paise` = CASE
		WHEN `amount` >= 0 AND `amount` <= 90071992547409 THEN `amount` * 100
		ELSE NULL
	END,
	`description` = `source`,
	`status` = 'needs_review',
	`source_type` = 'legacy',
	`created_by` = `owner_key`,
	`entry_number` = 'LEGACY-' || upper(substr(replace(`id`, '-', ''), 1, 8)),
	`provenance` = '{"schemaVersion":1,"classification":"legacy_unverified","includedInMetrics":false}'
WHERE `amount_paise` IS NULL;--> statement-breakpoint
UPDATE `business_profiles`
SET `setup_completed_at` = `updated_at`
WHERE `setup_completed_at` IS NULL;
