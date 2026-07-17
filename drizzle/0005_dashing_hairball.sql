CREATE TABLE `ai_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` integer NOT NULL,
	`approved_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_drafts_owner_status_idx` ON `ai_drafts` (`owner_key`,`status`);--> statement-breakpoint
CREATE TABLE `ai_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`rating` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`role` text NOT NULL,
	`kind` text DEFAULT 'message' NOT NULL,
	`content` text NOT NULL,
	`provider` text,
	`model` text,
	`metadata_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_messages_thread_created_idx` ON `ai_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`title` text NOT NULL,
	`context` text DEFAULT 'books' NOT NULL,
	`pending_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_threads_owner_updated_idx` ON `ai_threads` (`owner_key`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`tool_name` text NOT NULL,
	`input_summary` text NOT NULL,
	`result_status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_tool_calls_workspace_created_idx` ON `ai_tool_calls` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_reference` text,
	`summary` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_workspace_created_idx` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `corporate_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`security_id` text NOT NULL,
	`action_type` text NOT NULL,
	`effective_date` text NOT NULL,
	`source` text NOT NULL,
	`payload_json` text NOT NULL,
	`retrieved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`freshness_label` text NOT NULL,
	`last_success_at` integer,
	`last_error_at` integer,
	`metadata_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_sources_workspace_kind_provider_idx` ON `data_sources` (`workspace_id`,`kind`,`provider`);--> statement-breakpoint
CREATE TABLE `holding_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`security_id` text NOT NULL,
	`source_transaction_id` text NOT NULL,
	`original_quantity_micros` integer NOT NULL,
	`remaining_quantity_micros` integer NOT NULL,
	`cost_paise` integer NOT NULL,
	`acquired_at` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`security_id` text,
	`transaction_type` text NOT NULL,
	`trade_date` text NOT NULL,
	`quantity_micros` integer,
	`price_paise` integer,
	`amount_paise` integer NOT NULL,
	`fees_paise` integer DEFAULT 0 NOT NULL,
	`taxes_paise` integer DEFAULT 0 NOT NULL,
	`note` text,
	`provenance_json` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_transactions_owner_idempotency_idx` ON `investment_transactions` (`owner_key`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `investment_transactions_portfolio_date_idx` ON `investment_transactions` (`portfolio_id`,`trade_date`);--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`security_id` text,
	`headline` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`published_at` integer NOT NULL,
	`retrieved_at` integer NOT NULL,
	`summary` text
);
--> statement-breakpoint
CREATE TABLE `portfolio_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`name` text NOT NULL,
	`account_type` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`portfolio_type` text DEFAULT 'personal' NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`is_paper` integer DEFAULT false NOT NULL,
	`guardian_managed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `portfolios_owner_updated_idx` ON `portfolios` (`owner_key`,`updated_at`);--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`security_id` text NOT NULL,
	`price_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`source` text NOT NULL,
	`observed_at` integer NOT NULL,
	`retrieved_at` integer NOT NULL,
	`delay_minutes` integer NOT NULL,
	`licensing_status` text NOT NULL,
	`error_status` text
);
--> statement-breakpoint
CREATE INDEX `price_snapshots_security_observed_idx` ON `price_snapshots` (`security_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `research_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`security_id` text,
	`title` text NOT NULL,
	`facts_json` text NOT NULL,
	`analysis` text,
	`sources_json` text NOT NULL,
	`retrieved_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`exchange` text NOT NULL,
	`name` text NOT NULL,
	`asset_class` text NOT NULL,
	`sector` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_symbol_exchange_idx` ON `securities` (`symbol`,`exchange`);--> statement-breakpoint
CREATE TABLE `support_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`workspace_id` text NOT NULL,
	`topic` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`data_source_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`summary_json` text
);
--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`security_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_owner_security_idx` ON `watchlist_items` (`owner_key`,`security_id`);--> statement-breakpoint
CREATE TABLE `workspace_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_memberships_workspace_owner_idx` ON `workspace_memberships` (`workspace_id`,`owner_key`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'business' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `workspaces_owner_kind_idx` ON `workspaces` (`owner_key`,`kind`);--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `journal_lines_json` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `counterparty` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `reversal_of` text;--> statement-breakpoint
ALTER TABLE `accounting_entries` ADD `ai_draft_id` text;--> statement-breakpoint
ALTER TABLE `business_profiles` ADD `workspace_id` text;