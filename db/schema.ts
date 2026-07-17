import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ACC identity is an immutable internal user id. `access_mode` distinguishes an
// anonymous guest (the public default) from a legacy verified identity. Email is
// never an access key: it is optional contact information only. `google_subject`
// and `email` are nullable so a guest can exist with neither, while legacy rows
// keep their verified values. NULLs are distinct in a SQLite unique index, so
// unlimited guests coexist without colliding on these columns.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleSubject: text("google_subject"),
  email: text("email"),
  displayName: text("display_name").notNull().default("Guest"),
  accessMode: text("access_mode").notNull().default("guest"),
  optionalContactEmail: text("optional_contact_email"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
  lastActiveAt: integer("last_active_at"),
}, (table) => [
  uniqueIndex("users_google_subject_idx").on(table.googleSubject),
  uniqueIndex("users_email_idx").on(table.email),
]);

export const authSessions = sqliteTable("auth_sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => [index("auth_sessions_user_expires_idx").on(table.userId, table.expiresAt)]);

export const rateLimitEvents = sqliteTable("rate_limit_events", {
  id: text("id").primaryKey(),
  ownerKey: text("owner_key").notNull(),
  routeKey: text("route_key").notNull(),
  windowStart: integer("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("rate_limit_owner_route_window_idx").on(table.ownerKey, table.routeKey, table.windowStart)]);

export const privacyReceipts = sqliteTable("privacy_receipts", {
  id: text("id").primaryKey(),
  userIdHash: text("user_id_hash").notNull(),
  action: text("action").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const accountingEntries = sqliteTable(
  "accounting_entries",
  {
    id: text("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    date: text("date").notNull(),
    source: text("source").notNull(),
    amount: integer("amount").notNull(),
    debit: text("debit").notNull(),
    credit: text("credit").notNull(),
    kind: text("kind").notNull(),
    settlement: text("settlement").notNull(),
    sourceFile: text("source_file"),
    createdAt: integer("created_at").notNull(),
    // Canonical v2 fields. The original rupee `amount` and display-oriented
    // columns stay in place so existing D1 databases can be migrated without
    // rewriting or dropping a user's records.
    amountPaise: integer("amount_paise"),
    description: text("description"),
    transactionType: text("transaction_type"),
    category: text("category"),
    status: text("status").notNull().default("needs_review"),
    sourceType: text("source_type").notNull().default("legacy"),
    createdBy: text("created_by"),
    entryNumber: text("entry_number"),
    provenance: text("provenance"),
    idempotencyKey: text("idempotency_key"),
    workspaceId: text("workspace_id"),
    journalLinesJson: text("journal_lines_json"),
    counterparty: text("counterparty"),
    reversalOf: text("reversal_of"),
    aiDraftId: text("ai_draft_id"),
  },
  (table) => [
    index("accounting_entries_owner_created_idx").on(table.ownerKey, table.createdAt),
    uniqueIndex("accounting_entries_owner_idempotency_idx").on(table.ownerKey, table.idempotencyKey),
    uniqueIndex("accounting_entries_ai_draft_idx").on(table.aiDraftId),
  ],
);

export const periodLocks = sqliteTable("period_locks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at").notNull(),
  unlockedAt: integer("unlocked_at"),
}, (table) => [index("period_locks_workspace_dates_idx").on(table.workspaceId, table.startDate, table.endDate)]);

export const bankStatementImports = sqliteTable("bank_statement_imports", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), ownerKey: text("owner_key").notNull(),
  fileName: text("file_name").notNull(), fileHash: text("file_hash").notNull(), status: text("status").notNull(),
  rowCount: integer("row_count").notNull().default(0), createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("bank_import_workspace_hash_idx").on(table.workspaceId, table.fileHash)]);

export const bankStatementLines = sqliteTable("bank_statement_lines", {
  id: text("id").primaryKey(), importId: text("import_id").notNull(), workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(), transactionDate: text("transaction_date").notNull(), description: text("description").notNull(),
  amountPaise: integer("amount_paise").notNull(), direction: text("direction").notNull(), matchedEntryId: text("matched_entry_id"),
  matchStatus: text("match_status").notNull().default("unmatched"), createdAt: integer("created_at").notNull(),
}, (table) => [index("bank_lines_workspace_date_idx").on(table.workspaceId, table.transactionDate)]);

export const inventoryItems = sqliteTable("inventory_items", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), ownerKey: text("owner_key").notNull(),
  name: text("name").notNull(), sku: text("sku"), unit: text("unit").notNull().default("unit"),
  quantityMicros: integer("quantity_micros").notNull().default(0), costPaise: integer("cost_paise").notNull().default(0),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("inventory_workspace_sku_idx").on(table.workspaceId, table.sku)]);

export const fixedAssets = sqliteTable("fixed_assets", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), ownerKey: text("owner_key").notNull(),
  name: text("name").notNull(), acquisitionDate: text("acquisition_date").notNull(), costPaise: integer("cost_paise").notNull(),
  accumulatedDepreciationPaise: integer("accumulated_depreciation_paise").notNull().default(0), method: text("method").notNull().default("manual"),
  usefulLifeMonths: integer("useful_life_months"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
});

export const businessProfiles = sqliteTable("business_profiles", {
  ownerKey: text("owner_key").primaryKey(),
  ownerName: text("owner_name").notNull(),
  googleEmail: text("google_email").notNull(),
  workspaceName: text("workspace_name").notNull(),
  entityType: text("entity_type").notNull(),
  annualRevenue: integer("annual_revenue").notNull(),
  financialYear: text("financial_year").notNull(),
  openingAccounts: text("opening_accounts").notNull(),
  updatedAt: integer("updated_at").notNull(),
  businessType: text("business_type"),
  customBusinessType: text("custom_business_type"),
  legalStructure: text("legal_structure"),
  openingBankPaise: integer("opening_bank_paise"),
  cashInHandPaise: integer("cash_in_hand_paise"),
  openingCapitalPaise: integer("opening_capital_paise"),
  connectionMode: text("connection_mode"),
  setupCompletedAt: integer("setup_completed_at"),
  profileVersion: integer("profile_version").notNull().default(1),
  workspaceId: text("workspace_id"),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  ownerKey: text("owner_key").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("business"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  archivedAt: integer("archived_at"),
}, (table) => [
  index("workspaces_owner_kind_idx").on(table.ownerKey, table.kind),
]);

export const workspaceMemberships = sqliteTable("workspace_memberships", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  role: text("role").notNull().default("owner"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("workspace_memberships_workspace_owner_idx").on(table.workspaceId, table.ownerKey),
]);

export const aiThreads = sqliteTable("ai_threads", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  title: text("title").notNull(),
  context: text("context").notNull().default("books"),
  pendingJson: text("pending_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  archivedAt: integer("archived_at"),
}, (table) => [
  index("ai_threads_owner_updated_idx").on(table.ownerKey, table.updatedAt),
]);

export const aiMessages = sqliteTable("ai_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  role: text("role").notNull(),
  kind: text("kind").notNull().default("message"),
  content: text("content").notNull(),
  provider: text("provider"),
  model: text("model"),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("ai_messages_thread_created_idx").on(table.threadId, table.createdAt),
]);

export const aiToolCalls = sqliteTable("ai_tool_calls", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  toolName: text("tool_name").notNull(),
  inputSummary: text("input_summary").notNull(),
  resultStatus: text("result_status").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("ai_tool_calls_workspace_created_idx").on(table.workspaceId, table.createdAt)]);

export const aiFeedback = sqliteTable("ai_feedback", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  rating: text("rating").notNull(),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

export const aiDrafts = sqliteTable("ai_drafts", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull().default("proposed"),
  createdAt: integer("created_at").notNull(),
  approvedAt: integer("approved_at"),
}, (table) => [index("ai_drafts_owner_status_idx").on(table.ownerKey, table.status)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityReference: text("entity_reference"),
  summary: text("summary").notNull(),
  metadataJson: text("metadata_json"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt)]);

export const dataSources = sqliteTable("data_sources", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  kind: text("kind").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  freshnessLabel: text("freshness_label").notNull(),
  lastSuccessAt: integer("last_success_at"),
  lastErrorAt: integer("last_error_at"),
  metadataJson: text("metadata_json"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("data_sources_workspace_kind_provider_idx").on(table.workspaceId, table.kind, table.provider)]);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  dataSourceId: text("data_source_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  summaryJson: text("summary_json"),
});

export const portfolios = sqliteTable("portfolios", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  name: text("name").notNull(),
  portfolioType: text("portfolio_type").notNull().default("personal"),
  currency: text("currency").notNull().default("INR"),
  isPaper: integer("is_paper", { mode: "boolean" }).notNull().default(false),
  guardianManaged: integer("guardian_managed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  archivedAt: integer("archived_at"),
}, (table) => [index("portfolios_owner_updated_idx").on(table.ownerKey, table.updatedAt)]);

export const portfolioAccounts = sqliteTable("portfolio_accounts", {
  id: text("id").primaryKey(),
  portfolioId: text("portfolio_id").notNull(),
  name: text("name").notNull(),
  accountType: text("account_type").notNull().default("manual"),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
});

export const securities = sqliteTable("securities", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  sector: text("sector"),
  currency: text("currency").notNull().default("INR"),
  source: text("source").notNull().default("manual"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("securities_symbol_exchange_idx").on(table.symbol, table.exchange)]);

export const watchlistItems = sqliteTable("watchlist_items", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  securityId: text("security_id").notNull(),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("watchlist_owner_security_idx").on(table.ownerKey, table.securityId)]);

export const investmentTransactions = sqliteTable("investment_transactions", {
  id: text("id").primaryKey(),
  portfolioId: text("portfolio_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  securityId: text("security_id"),
  transactionType: text("transaction_type").notNull(),
  tradeDate: text("trade_date").notNull(),
  quantityMicros: integer("quantity_micros"),
  pricePaise: integer("price_paise"),
  amountPaise: integer("amount_paise").notNull(),
  feesPaise: integer("fees_paise").notNull().default(0),
  taxesPaise: integer("taxes_paise").notNull().default(0),
  note: text("note"),
  provenanceJson: text("provenance_json").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("investment_transactions_owner_idempotency_idx").on(table.ownerKey, table.idempotencyKey),
  index("investment_transactions_portfolio_date_idx").on(table.portfolioId, table.tradeDate),
]);

export const holdingLots = sqliteTable("holding_lots", {
  id: text("id").primaryKey(),
  portfolioId: text("portfolio_id").notNull(),
  securityId: text("security_id").notNull(),
  sourceTransactionId: text("source_transaction_id").notNull(),
  originalQuantityMicros: integer("original_quantity_micros").notNull(),
  remainingQuantityMicros: integer("remaining_quantity_micros").notNull(),
  costPaise: integer("cost_paise").notNull(),
  acquiredAt: text("acquired_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const priceSnapshots = sqliteTable("price_snapshots", {
  id: text("id").primaryKey(),
  securityId: text("security_id").notNull(),
  pricePaise: integer("price_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  source: text("source").notNull(),
  observedAt: integer("observed_at").notNull(),
  retrievedAt: integer("retrieved_at").notNull(),
  delayMinutes: integer("delay_minutes").notNull(),
  licensingStatus: text("licensing_status").notNull(),
  errorStatus: text("error_status"),
}, (table) => [index("price_snapshots_security_observed_idx").on(table.securityId, table.observedAt)]);

export const manualPriceSnapshots = sqliteTable("manual_price_snapshots", {
  id: text("id").primaryKey(),
  securityId: text("security_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  pricePaise: integer("price_paise").notNull(),
  currency: text("currency").notNull().default("INR"),
  observedAt: integer("observed_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("manual_prices_workspace_security_observed_idx").on(table.workspaceId, table.securityId, table.observedAt),
]);

export const corporateActions = sqliteTable("corporate_actions", {
  id: text("id").primaryKey(),
  securityId: text("security_id").notNull(),
  actionType: text("action_type").notNull(),
  effectiveDate: text("effective_date").notNull(),
  source: text("source").notNull(),
  payloadJson: text("payload_json").notNull(),
  retrievedAt: integer("retrieved_at").notNull(),
});

export const researchItems = sqliteTable("research_items", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  securityId: text("security_id"),
  title: text("title").notNull(),
  factsJson: text("facts_json").notNull(),
  analysis: text("analysis"),
  sourcesJson: text("sources_json").notNull(),
  retrievedAt: integer("retrieved_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const newsItems = sqliteTable("news_items", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  securityId: text("security_id"),
  headline: text("headline").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  publishedAt: integer("published_at").notNull(),
  retrievedAt: integer("retrieved_at").notNull(),
  summary: text("summary"),
});

export const marketProfiles = sqliteTable("market_profiles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  industry: text("industry").notNull().default(""),
  productCategory: text("product_category").notNull().default(""),
  targetCustomer: text("target_customer").notNull().default(""),
  customerAgeRange: text("customer_age_range"),
  geography: text("geography").notNull().default(""),
  channel: text("channel").notNull().default(""),
  pricePositioning: text("price_positioning").notNull().default(""),
  currentProducts: text("current_products").notNull().default(""),
  expansionObjective: text("expansion_objective").notNull().default(""),
  experimentBudget: text("experiment_budget").notNull().default(""),
  monitoringFrequency: text("monitoring_frequency").notNull().default("weekly"),
  booksFitEnabled: integer("books_fit_enabled", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("market_profiles_workspace_owner_idx").on(table.workspaceId, table.ownerKey)]);

export const marketSources = sqliteTable("market_sources", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  provider: text("provider").notNull(),
  sourceType: text("source_type").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull(),
  termsStatus: text("terms_status").notNull(),
  freshnessLabel: text("freshness_label").notNull(),
  lastSuccessAt: integer("last_success_at"),
  lastErrorAt: integer("last_error_at"),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("market_sources_workspace_provider_idx").on(table.workspaceId, table.provider)]);

export const marketCollectionRuns = sqliteTable("market_collection_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  queryJson: text("query_json").notNull(),
  sourceResultsJson: text("source_results_json").notNull(),
  previousReportPreserved: integer("previous_report_preserved", { mode: "boolean" }).notNull().default(true),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
}, (table) => [index("market_collection_runs_workspace_started_idx").on(table.workspaceId, table.startedAt)]);

export const marketSignals = sqliteTable("market_signals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  sourceId: text("source_id").notNull(),
  provider: text("provider").notNull(),
  sourceType: text("source_type").notNull(),
  externalId: text("external_id").notNull(),
  publicUrl: text("public_url").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  publishedAt: integer("published_at").notNull(),
  retrievedAt: integer("retrieved_at").notNull(),
  language: text("language").notNull(),
  geography: text("geography"),
  engagementJson: text("engagement_json").notNull(),
  processingVersion: text("processing_version").notNull(),
  contentHash: text("content_hash").notNull(),
  duplicateStatus: text("duplicate_status").notNull(),
  promotionStatus: text("promotion_status").notNull(),
  relevanceStatus: text("relevance_status").notNull(),
  problemKindsJson: text("problem_kinds_json").notNull(),
  expirationAt: integer("expiration_at"),
  deletedAt: integer("deleted_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("market_signals_workspace_provider_external_idx").on(table.workspaceId, table.provider, table.externalId),
  index("market_signals_workspace_published_idx").on(table.workspaceId, table.publishedAt),
]);

export const marketCleaningRuns = sqliteTable("market_cleaning_runs", {
  id: text("id").primaryKey(),
  collectionRunId: text("collection_run_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  rawItemsCollected: integer("raw_items_collected").notNull(),
  duplicatesRemoved: integer("duplicates_removed").notNull(),
  promotionalItemsFiltered: integer("promotional_items_filtered").notNull(),
  relevantItemsRetained: integer("relevant_items_retained").notNull(),
  languagesJson: text("languages_json").notNull(),
  sourcesJson: text("sources_json").notNull(),
  processingFailures: integer("processing_failures").notNull(),
  processingVersion: text("processing_version").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const marketProblemClusters = sqliteTable("market_problem_clusters", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  problemKey: text("problem_key").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  relevantItems: integer("relevant_items").notNull(),
  sourceTypesJson: text("source_types_json").notNull(),
  startAt: integer("start_at").notNull(),
  endAt: integer("end_at").notNull(),
  momentumPercent: integer("momentum_percent"),
  classification: text("classification").notNull(),
  classificationReason: text("classification_reason").notNull(),
  geographyJson: text("geography_json").notNull(),
  purchaseIntentItems: integer("purchase_intent_items").notNull(),
  alternativeSeekingItems: integer("alternative_seeking_items").notNull(),
  confidence: text("confidence").notNull(),
  limitationsJson: text("limitations_json").notNull(),
  evidenceSignalIdsJson: text("evidence_signal_ids_json").notNull(),
  methodologyVersion: text("methodology_version").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("market_problem_clusters_workspace_key_idx").on(table.workspaceId, table.problemKey)]);

export const marketOpportunities = sqliteTable("market_opportunities", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  clusterId: text("cluster_id").notNull(),
  title: text("title").notNull(),
  customerProblem: text("customer_problem").notNull(),
  targetCustomer: text("target_customer").notNull(),
  geography: text("geography").notNull(),
  lifecycleStatus: text("lifecycle_status").notNull().default("detected"),
  hypothesis: text("hypothesis").notNull(),
  validationExperiment: text("validation_experiment").notNull(),
  successMeasure: text("success_measure").notNull(),
  evidenceSummaryJson: text("evidence_summary_json").notNull(),
  risksJson: text("risks_json").notNull(),
  conflictingEvidenceJson: text("conflicting_evidence_json").notNull(),
  dataGapsJson: text("data_gaps_json").notNull(),
  scoresJson: text("scores_json").notNull(),
  timeRangeStart: integer("time_range_start").notNull(),
  timeRangeEnd: integer("time_range_end").notNull(),
  discussionsAnalyzed: integer("discussions_analyzed").notNull(),
  sourceCoverage: integer("source_coverage").notNull(),
  confidence: text("confidence").notNull(),
  methodologyVersion: text("methodology_version").notNull(),
  reviewedAt: integer("reviewed_at"),
  savedAt: integer("saved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("market_opportunities_workspace_cluster_idx").on(table.workspaceId, table.clusterId)]);

export const marketOpportunityEvents = sqliteTable("market_opportunity_events", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("market_opportunity_events_opportunity_created_idx").on(table.opportunityId, table.createdAt)]);

export const marketExperiments = sqliteTable("market_experiments", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  description: text("description").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  customersContacted: integer("customers_contacted").notNull().default(0),
  responses: integer("responses").notNull().default(0),
  trialOrders: integer("trial_orders").notNull().default(0),
  trialRevenuePaise: integer("trial_revenue_paise").notNull().default(0),
  trialCostPaise: integer("trial_cost_paise").notNull().default(0),
  returnsCount: integer("returns_count").notNull().default(0),
  complaintsCount: integer("complaints_count").notNull().default(0),
  estimatedResponseRateBps: integer("estimated_response_rate_bps"),
  result: text("result"),
  decision: text("decision"),
  notes: text("notes"),
  status: text("status").notNull().default("planned"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("market_experiments_workspace_updated_idx").on(table.workspaceId, table.updatedAt)]);

export const marketCompetitorInsights = sqliteTable("market_competitor_insights", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  competitorName: text("competitor_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  observedAt: integer("observed_at").notNull(),
  observation: text("observation").notNull(),
  inference: text("inference").notNull(),
  confidence: text("confidence").notNull(),
  limitation: text("limitation").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const marketAlerts = sqliteTable("market_alerts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  alertType: text("alert_type").notNull(),
  title: text("title").notNull(),
  whatChanged: text("what_changed").notNull(),
  comparedPeriod: text("compared_period").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  confidence: text("confidence").notNull(),
  sourceFreshness: text("source_freshness").notNull(),
  entityReference: text("entity_reference"),
  dismissedAt: integer("dismissed_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("market_alerts_workspace_fingerprint_idx").on(table.workspaceId, table.fingerprint)]);

export const supportRequests = sqliteTable("support_requests", {
  id: text("id").primaryKey(),
  ownerKey: text("owner_key").notNull(),
  workspaceId: text("workspace_id").notNull(),
  topic: text("topic").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("received"),
  createdAt: integer("created_at").notNull(),
});
