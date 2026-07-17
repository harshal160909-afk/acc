CREATE TABLE `business_profiles` (
	`owner_key` text PRIMARY KEY NOT NULL,
	`owner_name` text NOT NULL,
	`google_email` text NOT NULL,
	`workspace_name` text NOT NULL,
	`entity_type` text NOT NULL,
	`annual_revenue` integer NOT NULL,
	`financial_year` text NOT NULL,
	`opening_accounts` text NOT NULL,
	`updated_at` integer NOT NULL
);
