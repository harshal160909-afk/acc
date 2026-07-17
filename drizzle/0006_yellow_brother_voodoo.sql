CREATE TABLE `market_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`alert_type` text NOT NULL,
	`title` text NOT NULL,
	`what_changed` text NOT NULL,
	`compared_period` text NOT NULL,
	`evidence_json` text NOT NULL,
	`confidence` text NOT NULL,
	`source_freshness` text NOT NULL,
	`entity_reference` text,
	`dismissed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_alerts_workspace_fingerprint_idx` ON `market_alerts` (`workspace_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `market_cleaning_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_run_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`raw_items_collected` integer NOT NULL,
	`duplicates_removed` integer NOT NULL,
	`promotional_items_filtered` integer NOT NULL,
	`relevant_items_retained` integer NOT NULL,
	`languages_json` text NOT NULL,
	`sources_json` text NOT NULL,
	`processing_failures` integer NOT NULL,
	`processing_version` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_collection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`query_json` text NOT NULL,
	`source_results_json` text NOT NULL,
	`previous_report_preserved` integer DEFAULT true NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `market_collection_runs_workspace_started_idx` ON `market_collection_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `market_competitor_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`competitor_name` text NOT NULL,
	`source_url` text NOT NULL,
	`observed_at` integer NOT NULL,
	`observation` text NOT NULL,
	`inference` text NOT NULL,
	`confidence` text NOT NULL,
	`limitation` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`description` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`customers_contacted` integer DEFAULT 0 NOT NULL,
	`responses` integer DEFAULT 0 NOT NULL,
	`trial_orders` integer DEFAULT 0 NOT NULL,
	`trial_revenue_paise` integer DEFAULT 0 NOT NULL,
	`trial_cost_paise` integer DEFAULT 0 NOT NULL,
	`returns_count` integer DEFAULT 0 NOT NULL,
	`complaints_count` integer DEFAULT 0 NOT NULL,
	`estimated_response_rate_bps` integer,
	`result` text,
	`decision` text,
	`notes` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_experiments_workspace_updated_idx` ON `market_experiments` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `market_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`cluster_id` text NOT NULL,
	`title` text NOT NULL,
	`customer_problem` text NOT NULL,
	`target_customer` text NOT NULL,
	`geography` text NOT NULL,
	`lifecycle_status` text DEFAULT 'detected' NOT NULL,
	`hypothesis` text NOT NULL,
	`validation_experiment` text NOT NULL,
	`success_measure` text NOT NULL,
	`evidence_summary_json` text NOT NULL,
	`risks_json` text NOT NULL,
	`conflicting_evidence_json` text NOT NULL,
	`data_gaps_json` text NOT NULL,
	`scores_json` text NOT NULL,
	`time_range_start` integer NOT NULL,
	`time_range_end` integer NOT NULL,
	`discussions_analyzed` integer NOT NULL,
	`source_coverage` integer NOT NULL,
	`confidence` text NOT NULL,
	`methodology_version` text NOT NULL,
	`reviewed_at` integer,
	`saved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_opportunities_workspace_cluster_idx` ON `market_opportunities` (`workspace_id`,`cluster_id`);--> statement-breakpoint
CREATE TABLE `market_opportunity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_opportunity_events_opportunity_created_idx` ON `market_opportunity_events` (`opportunity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `market_problem_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`problem_key` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`relevant_items` integer NOT NULL,
	`source_types_json` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`momentum_percent` integer,
	`classification` text NOT NULL,
	`classification_reason` text NOT NULL,
	`geography_json` text NOT NULL,
	`purchase_intent_items` integer NOT NULL,
	`alternative_seeking_items` integer NOT NULL,
	`confidence` text NOT NULL,
	`limitations_json` text NOT NULL,
	`evidence_signal_ids_json` text NOT NULL,
	`methodology_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_problem_clusters_workspace_key_idx` ON `market_problem_clusters` (`workspace_id`,`problem_key`);--> statement-breakpoint
CREATE TABLE `market_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`product_category` text DEFAULT '' NOT NULL,
	`target_customer` text DEFAULT '' NOT NULL,
	`customer_age_range` text,
	`geography` text DEFAULT '' NOT NULL,
	`channel` text DEFAULT '' NOT NULL,
	`price_positioning` text DEFAULT '' NOT NULL,
	`current_products` text DEFAULT '' NOT NULL,
	`expansion_objective` text DEFAULT '' NOT NULL,
	`experiment_budget` text DEFAULT '' NOT NULL,
	`monitoring_frequency` text DEFAULT 'weekly' NOT NULL,
	`books_fit_enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_profiles_workspace_owner_idx` ON `market_profiles` (`workspace_id`,`owner_key`);--> statement-breakpoint
CREATE TABLE `market_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`source_id` text NOT NULL,
	`provider` text NOT NULL,
	`source_type` text NOT NULL,
	`external_id` text NOT NULL,
	`public_url` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text NOT NULL,
	`published_at` integer NOT NULL,
	`retrieved_at` integer NOT NULL,
	`language` text NOT NULL,
	`geography` text,
	`engagement_json` text NOT NULL,
	`processing_version` text NOT NULL,
	`content_hash` text NOT NULL,
	`duplicate_status` text NOT NULL,
	`promotion_status` text NOT NULL,
	`relevance_status` text NOT NULL,
	`problem_kinds_json` text NOT NULL,
	`expiration_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_signals_workspace_provider_external_idx` ON `market_signals` (`workspace_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `market_signals_workspace_published_idx` ON `market_signals` (`workspace_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `market_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`provider` text NOT NULL,
	`source_type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`terms_status` text NOT NULL,
	`freshness_label` text NOT NULL,
	`last_success_at` integer,
	`last_error_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_sources_workspace_provider_idx` ON `market_sources` (`workspace_id`,`provider`);