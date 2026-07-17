import { calculateFinancialSummary, financialYearToDateRange } from "@/app/lib/finance";
import {
  buildProblemClusters,
  calculateExperimentEvaluation,
  calculateTransparentOpportunityScore,
  cleanMarketSignals,
  forecastingGate,
  MARKET_METHODOLOGY_VERSION,
  MARKET_PROCESSING_VERSION,
  MARKET_SCORE_WEIGHTS,
  type CleanedMarketSignal,
  type ProblemCluster,
} from "@/app/lib/market-intelligence";
import { collectPermittedMarketSignals, marketConnectorStatuses, type MarketConnectorName } from "@/app/lib/market-intelligence/connectors";
import { getRequestIdentity, unauthenticatedResponse } from "@/app/lib/server/auth";
import { loadWorkspaceBooks } from "@/app/lib/server/books";
import { ensureStore, getDatabase, recordAuditEvent, resolveWorkspace, safeJson, type Database } from "@/app/lib/server/context";
import { ensureMarketIntelligenceStore } from "@/app/lib/server/market-intelligence-store";
import { enforceRateLimit, validateJsonMutation } from "@/app/lib/server/http-security";

type ProfileRow = {
  id: string; workspace_id: string; owner_key: string; industry: string; product_category: string;
  target_customer: string; customer_age_range: string | null; geography: string; channel: string;
  price_positioning: string; current_products: string; expansion_objective: string;
  experiment_budget: string; monitoring_frequency: string; books_fit_enabled: number;
  status: string; created_at: number; updated_at: number;
};
type SourceRow = { id: string; provider: string; source_type: string; enabled: number; status: string; terms_status: string; freshness_label: string; last_success_at: number | null; last_error_at: number | null; last_error: string | null; updated_at: number };
type RunRow = { id: string; status: string; stage: string; query_json: string; source_results_json: string; previous_report_preserved: number; started_at: number; completed_at: number | null };
type CleaningRow = { raw_items_collected: number; duplicates_removed: number; promotional_items_filtered: number; relevant_items_retained: number; languages_json: string; sources_json: string; processing_failures: number; processing_version: string; created_at: number };
type SignalRow = { id: string; provider: string; source_type: string; external_id: string; public_url: string; title: string; excerpt: string; published_at: number; retrieved_at: number; language: string; geography: string | null; engagement_json: string; problem_kinds_json: string; expiration_at: number | null };
type ClusterRow = { id: string; problem_key: string; title: string; summary: string; relevant_items: number; source_types_json: string; start_at: number; end_at: number; momentum_percent: number | null; classification: string; classification_reason: string; geography_json: string; purchase_intent_items: number; alternative_seeking_items: number; confidence: string; limitations_json: string; evidence_signal_ids_json: string; methodology_version: string; updated_at: number };
type OpportunityRow = { id: string; cluster_id: string; title: string; customer_problem: string; target_customer: string; geography: string; lifecycle_status: string; hypothesis: string; validation_experiment: string; success_measure: string; evidence_summary_json: string; risks_json: string; conflicting_evidence_json: string; data_gaps_json: string; scores_json: string; time_range_start: number; time_range_end: number; discussions_analyzed: number; source_coverage: number; confidence: string; methodology_version: string; reviewed_at: number | null; saved_at: number | null; created_at: number; updated_at: number };
type ExperimentRow = { id: string; opportunity_id: string; description: string; start_date: string; end_date: string | null; customers_contacted: number; responses: number; trial_orders: number; trial_revenue_paise: number; trial_cost_paise: number; returns_count: number; complaints_count: number; estimated_response_rate_bps: number | null; result: string | null; decision: string | null; notes: string | null; status: string; created_at: number; updated_at: number };
type CompetitorRow = { id: string; competitor_name: string; source_url: string; observed_at: number; observation: string; inference: string; confidence: string; limitation: string; created_at: number };
type AlertRow = { id: string; fingerprint: string; alert_type: string; title: string; what_changed: string; compared_period: string; evidence_json: string; confidence: string; source_freshness: string; entity_reference: string | null; dismissed_at: number | null; created_at: number };

const PROFILE_FIELDS = ["industry", "productCategory", "targetCustomer", "geography", "channel", "pricePositioning", "currentProducts", "expansionObjective", "experimentBudget", "monitoringFrequency"] as const;
const FREQUENCIES = new Set(["daily", "weekly", "fortnightly", "monthly"]);
const CHANNELS = new Set(["online", "offline", "both"]);
const LIFECYCLE = new Set(["detected", "reviewed", "saved", "experiment_planned", "experiment_running", "result_recorded", "launched", "rejected", "postponed"]);

function cleanText(value: unknown, maximum = 240, allowEmpty = false) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ((!text && !allowEmpty) || text.length > maximum) return null;
  return text;
}

function cleanInteger(value: unknown, maximum = 10_000_000) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function validId(value: unknown) { return typeof value === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(value); }
function validDate(value: unknown) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)); }
function validHttpsUrl(value: unknown) { if (typeof value !== "string" || value.length > 1_000) return false; try { return new URL(value).protocol === "https:"; } catch { return false; } }
function publicProfile(row: ProfileRow) { return { id: row.id, industry: row.industry, productCategory: row.product_category, targetCustomer: row.target_customer, customerAgeRange: row.customer_age_range ?? "", geography: row.geography, channel: row.channel, pricePositioning: row.price_positioning, currentProducts: row.current_products, expansionObjective: row.expansion_objective, experimentBudget: row.experiment_budget, monitoringFrequency: row.monitoring_frequency, booksFitEnabled: Boolean(row.books_fit_enabled), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
function profileComplete(profile: ReturnType<typeof publicProfile>) { return PROFILE_FIELDS.every((field) => profile[field].trim().length > 0); }

async function prepare(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) return null;
  const email = identity.userId;
  const database = await getDatabase();
  await ensureStore(database);
  await ensureMarketIntelligenceStore(database);
  const workspace = await resolveWorkspace(database, email);
  return { email, database, workspace };
}

async function ensureProfile(database: Database, workspaceId: string, email: string) {
  const existing = await database.prepare("SELECT * FROM market_profiles WHERE workspace_id = ? AND owner_key = ? LIMIT 1").bind(workspaceId, email).all<ProfileRow>();
  if (existing.results[0]) return existing.results[0];
  const books = await loadWorkspaceBooks(database, email);
  const genre = books.config.customBusinessType.trim() || books.config.businessType.replaceAll("_", " ");
  const channel = books.config.businessType === "ecommerce" ? "online" : books.config.businessType === "retail" ? "both" : "";
  const id = crypto.randomUUID(); const now = Date.now();
  await database.prepare(`INSERT INTO market_profiles (id, workspace_id, owner_key, industry, product_category, target_customer, customer_age_range, geography, channel, price_positioning, current_products, expansion_objective, experiment_budget, monitoring_frequency, books_fit_enabled, status, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', NULL, '', ?, '', '', '', '', 'weekly', 0, 'draft', ?, ?)`)
    .bind(id, workspaceId, email, genre, channel, now, now).run();
  const result = await database.prepare("SELECT * FROM market_profiles WHERE id = ? LIMIT 1").bind(id).all<ProfileRow>();
  if (!result.results[0]) throw new Error("Market profile could not be prepared");
  return result.results[0];
}

async function syncSourceRows(database: Database, workspaceId: string, email: string) {
  const statuses = await marketConnectorStatuses(); const now = Date.now();
  for (const connector of statuses) {
    const status = connector.available ? "available" : connector.status;
    await database.prepare(`INSERT INTO market_sources (id, workspace_id, owner_key, provider, source_type, enabled, status, terms_status, freshness_label, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(workspace_id, provider) DO UPDATE SET source_type = excluded.source_type, status = excluded.status, terms_status = excluded.terms_status, freshness_label = CASE WHEN market_sources.last_success_at IS NULL THEN excluded.freshness_label ELSE market_sources.freshness_label END, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), workspaceId, email, connector.provider, connector.sourceType, status, connector.complianceApproved ? "approval_confirmed" : "approval_required", connector.message, now).run();
  }
  const rows = await database.prepare("SELECT * FROM market_sources WHERE workspace_id = ? AND owner_key = ? ORDER BY provider").bind(workspaceId, email).all<SourceRow>();
  return rows.results.map((row) => ({ ...row, enabled: Boolean(row.enabled), connector: statuses.find((item) => item.provider === row.provider) ?? null }));
}

async function aggregateBooksFit(database: Database, email: string, enabled: boolean, experimentBudget: string) {
  if (!enabled) return { enabled: false, permission: "not_granted", metrics: null, scoreSignals: null, executionSignals: null };
  const { config, entries } = await loadWorkspaceBooks(database, email);
  const period = financialYearToDateRange(new Date().toISOString().slice(0, 10));
  const summary = calculateFinancialSummary(config, entries, period);
  const marketingSpendPaise = entries.filter((entry) => entry.category === "marketing_expense").reduce((total, entry) => total + entry.amountPaise, 0);
  const revenueCategories = [...new Set(entries.filter((entry) => entry.transactionType === "income").map((entry) => entry.category))];
  const budgetTargetPaise = experimentBudget.toLowerCase().includes("high") ? 500_000 : experimentBudget.toLowerCase().includes("medium") ? 200_000 : 50_000;
  const cashCoverage = Math.min(100, Math.round(summary.availableCash.amountPaise / Math.max(1, budgetTargetPaise) * 50));
  const profitability = summary.revenue.amountPaise > 0 ? Math.max(0, Math.min(100, Math.round((summary.profit?.amountPaise ?? 0) / summary.revenue.amountPaise * 100 + 50))) : 25;
  return {
    enabled: true,
    permission: "granted_by_owner",
    metrics: {
      availableCashPaise: summary.availableCash.amountPaise,
      revenuePaise: summary.revenue.amountPaise,
      expensesPaise: summary.expenses.amountPaise,
      profitPaise: summary.profit?.amountPaise ?? null,
      receivablesPaise: summary.receivables.amountPaise,
      marketingSpendPaise,
      revenueCategories,
      transactionCount: entries.length,
      sourceLabel: "Aggregated from posted ACC records only",
    },
    scoreSignals: [entries.length ? 70 : 20, revenueCategories.length ? 70 : 30, cashCoverage, profitability],
    executionSignals: [cashCoverage, marketingSpendPaise > 0 ? 70 : 40, entries.length >= 10 ? 75 : 45],
  };
}

async function loadPayload(database: Database, workspaceId: string, email: string) {
  const profileRow = await ensureProfile(database, workspaceId, email); const profile = publicProfile(profileRow);
  const sources = await syncSourceRows(database, workspaceId, email);
  await database.prepare("DELETE FROM market_signals WHERE workspace_id = ? AND expiration_at IS NOT NULL AND expiration_at <= ?").bind(workspaceId, Date.now()).run();
  const [runs, cleaning, signals, clusters, opportunities, experiments, competitors, alerts] = await Promise.all([
    database.prepare("SELECT * FROM market_collection_runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 1").bind(workspaceId).all<RunRow>(),
    database.prepare("SELECT * FROM market_cleaning_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1").bind(workspaceId).all<CleaningRow>(),
    database.prepare("SELECT id, provider, source_type, external_id, public_url, title, excerpt, published_at, retrieved_at, language, geography, engagement_json, problem_kinds_json, expiration_at FROM market_signals WHERE workspace_id = ? AND deleted_at IS NULL AND relevance_status = 'relevant' ORDER BY published_at DESC LIMIT 120").bind(workspaceId).all<SignalRow>(),
    database.prepare("SELECT * FROM market_problem_clusters WHERE workspace_id = ? ORDER BY relevant_items DESC, updated_at DESC").bind(workspaceId).all<ClusterRow>(),
    database.prepare("SELECT * FROM market_opportunities WHERE workspace_id = ? ORDER BY updated_at DESC").bind(workspaceId).all<OpportunityRow>(),
    database.prepare("SELECT * FROM market_experiments WHERE workspace_id = ? ORDER BY updated_at DESC").bind(workspaceId).all<ExperimentRow>(),
    database.prepare("SELECT * FROM market_competitor_insights WHERE workspace_id = ? ORDER BY observed_at DESC").bind(workspaceId).all<CompetitorRow>(),
    database.prepare("SELECT * FROM market_alerts WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100").bind(workspaceId).all<AlertRow>(),
  ]);
  const businessFit = await aggregateBooksFit(database, email, profile.booksFitEnabled, profile.experimentBudget);
  const publicSignals = signals.results.map((row) => ({ id: row.id, provider: row.provider, sourceType: row.source_type, externalId: row.external_id, publicUrl: row.public_url, title: row.title, excerpt: row.excerpt, publishedAt: row.published_at, retrievedAt: row.retrieved_at, language: row.language, geography: row.geography, engagement: safeJson(row.engagement_json, {}), problemKinds: safeJson(row.problem_kinds_json, []), expirationAt: row.expiration_at }));
  const publicClusters = clusters.results.map((row) => ({ id: row.id, key: row.problem_key, title: row.title, summary: row.summary, relevantItems: row.relevant_items, independentSourceTypes: safeJson(row.source_types_json, []), startAt: row.start_at, endAt: row.end_at, momentumPercent: row.momentum_percent, classification: row.classification, classificationReason: row.classification_reason, geographyEvidence: safeJson(row.geography_json, []), purchaseIntentItems: row.purchase_intent_items, alternativeSeekingItems: row.alternative_seeking_items, confidence: row.confidence, limitations: safeJson(row.limitations_json, []), evidenceSignalIds: safeJson(row.evidence_signal_ids_json, []), methodologyVersion: row.methodology_version, updatedAt: row.updated_at }));
  const publicOpportunities = opportunities.results.map((row) => ({ id: row.id, clusterId: row.cluster_id, title: row.title, customerProblem: row.customer_problem, targetCustomer: row.target_customer, geography: row.geography, lifecycleStatus: row.lifecycle_status, hypothesis: row.hypothesis, validationExperiment: row.validation_experiment, successMeasure: row.success_measure, evidenceSummary: safeJson(row.evidence_summary_json, {}), risks: safeJson(row.risks_json, []), conflictingEvidence: safeJson(row.conflicting_evidence_json, []), dataGaps: safeJson(row.data_gaps_json, []), scores: safeJson(row.scores_json, {}), timeRangeStart: row.time_range_start, timeRangeEnd: row.time_range_end, discussionsAnalyzed: row.discussions_analyzed, sourceCoverage: row.source_coverage, confidence: row.confidence, methodologyVersion: row.methodology_version, reviewedAt: row.reviewed_at, savedAt: row.saved_at, createdAt: row.created_at, updatedAt: row.updated_at }));
  const evaluation = calculateExperimentEvaluation(experiments.results.map((row) => ({ opportunityId: row.opportunity_id, status: row.status, decision: row.decision, startDate: row.start_date, endDate: row.end_date, estimatedResponseRateBps: row.estimated_response_rate_bps, customersContacted: row.customers_contacted, responses: row.responses })));
  const latestCleaning = cleaning.results[0]; const latestRun = runs.results[0];
  const durationDays = publicClusters.length ? Math.max(0, Math.round((Math.max(...publicClusters.map((item) => item.endAt)) - Math.min(...publicClusters.map((item) => item.startAt))) / 86_400_000)) : 0;
  const forecast = forecastingGate({ durationDays, independentSources: latestCleaning ? safeJson<string[]>(latestCleaning.sources_json, []).length : 0, relevantItems: latestCleaning?.relevant_items_retained ?? 0, stableRuns: 0, missingDataShare: sources.length ? sources.filter((source) => source.status !== "available").length / sources.length : 1, backtestReady: false });
  return {
    profile: { ...profile, complete: profileComplete(profile) }, sources,
    latestRun: latestRun ? { id: latestRun.id, status: latestRun.status, stage: latestRun.stage, query: safeJson(latestRun.query_json, {}), sourceResults: safeJson(latestRun.source_results_json, []), previousReportPreserved: Boolean(latestRun.previous_report_preserved), startedAt: latestRun.started_at, completedAt: latestRun.completed_at } : null,
    cleaningMetrics: latestCleaning ? { rawItemsCollected: latestCleaning.raw_items_collected, duplicatesRemoved: latestCleaning.duplicates_removed, promotionalItemsFiltered: latestCleaning.promotional_items_filtered, relevantItemsRetained: latestCleaning.relevant_items_retained, languagesDetected: safeJson(latestCleaning.languages_json, []), sourcesRepresented: safeJson(latestCleaning.sources_json, []), processingFailures: latestCleaning.processing_failures, processingVersion: latestCleaning.processing_version, createdAt: latestCleaning.created_at } : null,
    signals: publicSignals, clusters: publicClusters, opportunities: publicOpportunities,
    experiments: experiments.results.map((row) => ({ id: row.id, opportunityId: row.opportunity_id, description: row.description, startDate: row.start_date, endDate: row.end_date, customersContacted: row.customers_contacted, responses: row.responses, trialOrders: row.trial_orders, trialRevenuePaise: row.trial_revenue_paise, trialCostPaise: row.trial_cost_paise, returns: row.returns_count, complaints: row.complaints_count, estimatedResponseRateBps: row.estimated_response_rate_bps, result: row.result, decision: row.decision, notes: row.notes, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })),
    competitors: competitors.results.map((row) => ({ id: row.id, competitorName: row.competitor_name, sourceUrl: row.source_url, observedAt: row.observed_at, observation: row.observation, inference: row.inference, confidence: row.confidence, limitation: row.limitation, createdAt: row.created_at })),
    alerts: alerts.results.map((row) => ({ id: row.id, type: row.alert_type, title: row.title, whatChanged: row.what_changed, comparedPeriod: row.compared_period, evidence: safeJson(row.evidence_json, []), confidence: row.confidence, sourceFreshness: row.source_freshness, entityReference: row.entity_reference, dismissedAt: row.dismissed_at, createdAt: row.created_at })),
    caseStudies: experiments.results.filter((row) => ["launched", "rejected", "postponed"].includes(row.status)).map((row) => ({ experimentId: row.id, opportunityId: row.opportunity_id, description: row.description, decision: row.decision, result: row.result, customersContacted: row.customers_contacted, responses: row.responses, trialOrders: row.trial_orders, trialRevenuePaise: row.trial_revenue_paise, trialCostPaise: row.trial_cost_paise, startDate: row.start_date, endDate: row.end_date })),
    evaluation, businessFit,
    methodology: { version: MARKET_METHODOLOGY_VERSION, processingVersion: MARKET_PROCESSING_VERSION, weights: MARKET_SCORE_WEIGHTS, combinedScoreRule: "Weighted component score minus 25% of the uncertainty penalty. It is unavailable without minimum evidence and ACC Books permission.", forecast, guaranteesSuccess: false, privateSourcesAccessed: false },
  };
}

function queryForProfile(profile: ReturnType<typeof publicProfile>) {
  return [...new Set([profile.industry, profile.productCategory, profile.currentProducts, profile.targetCustomer].flatMap((value) => value.split(/[,;/]/)).map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}

async function scoreForCluster(database: Database, workspaceId: string, email: string, profile: ReturnType<typeof publicProfile>, cluster: ProblemCluster, allSignals: readonly CleanedMarketSignal[]) {
  const relevant = allSignals.filter((signal) => signal.relevant); const businessFit = await aggregateBooksFit(database, email, profile.booksFitEnabled, profile.experimentBudget);
  const competitorRows = await database.prepare("SELECT COUNT(*) AS count FROM market_competitor_insights WHERE workspace_id = ?").bind(workspaceId).all<{ count: number }>();
  const current = Date.now(); const clusterSignals = relevant.filter((signal) => signal.problemKinds.includes(cluster.key));
  return calculateTransparentOpportunityScore({
    relevantItems: cluster.relevantItems, independentSources: cluster.independentSourceTypes.length,
    averageSourceQuality: cluster.independentSourceTypes.reduce((sum, source) => sum + (source.includes("community") ? 76 : 72), 0) / Math.max(1, cluster.independentSourceTypes.length),
    recentItemShare: clusterSignals.length ? clusterSignals.filter((signal) => current - signal.publishedAt <= 30 * 86_400_000).length / clusterSignals.length : 0,
    geographicItemShare: clusterSignals.length ? clusterSignals.filter((signal) => Boolean(signal.geography)).length / clusterSignals.length : 0,
    momentumPercent: cluster.momentumPercent, durationDays: Math.max(1, Math.round((cluster.endAt - cluster.startAt) / 86_400_000)), recurrenceShare: cluster.relevantItems / Math.max(1, relevant.length),
    painSeverity: cluster.key === "bad_quality" || cluster.key === "excessive_price" ? 78 : 62,
    purchaseIntentShare: cluster.purchaseIntentItems / Math.max(1, cluster.relevantItems), alternativeSeekingShare: cluster.alternativeSeekingItems / Math.max(1, cluster.relevantItems),
    dissatisfactionShare: clusterSignals.filter((signal) => signal.problemKinds.some((kind) => ["bad_quality", "excessive_price", "poor_availability"].includes(kind))).length / Math.max(1, clusterSignals.length),
    competitorCount: Number(competitorRows.results[0]?.count ?? 0), competitorMomentum: 0,
    businessFitSignals: businessFit.scoreSignals, executionSignals: businessFit.executionSignals,
    conflictingEvidenceShare: 0, promotionalShare: allSignals.filter((signal) => signal.promotional).length / Math.max(1, allSignals.length),
    missingSourceCount: Math.max(0, 2 - cluster.independentSourceTypes.length), geographyVerified: cluster.geographyEvidence.length > 0, seasonalAmbiguity: false,
  });
}

async function upsertClusterAndOpportunity(database: Database, workspaceId: string, email: string, profile: ReturnType<typeof publicProfile>, cluster: ProblemCluster, signalIds: Map<string, string>, allSignals: readonly CleanedMarketSignal[]) {
  const previous = await database.prepare("SELECT id, classification, momentum_percent FROM market_problem_clusters WHERE workspace_id = ? AND problem_key = ? LIMIT 1").bind(workspaceId, cluster.key).all<{ id: string; classification: string; momentum_percent: number | null }>();
  const clusterId = previous.results[0]?.id ?? crypto.randomUUID(); const now = Date.now();
  const evidenceIds = cluster.representativeSignals.flatMap((signal) => { const id = signalIds.get(`${signal.provider}:${signal.externalId}`); return id ? [id] : []; });
  await database.prepare(`INSERT INTO market_problem_clusters (id, workspace_id, owner_key, problem_key, title, summary, relevant_items, source_types_json, start_at, end_at, momentum_percent, classification, classification_reason, geography_json, purchase_intent_items, alternative_seeking_items, confidence, limitations_json, evidence_signal_ids_json, methodology_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, problem_key) DO UPDATE SET title=excluded.title, summary=excluded.summary, relevant_items=excluded.relevant_items, source_types_json=excluded.source_types_json, start_at=excluded.start_at, end_at=excluded.end_at, momentum_percent=excluded.momentum_percent, classification=excluded.classification, classification_reason=excluded.classification_reason, geography_json=excluded.geography_json, purchase_intent_items=excluded.purchase_intent_items, alternative_seeking_items=excluded.alternative_seeking_items, confidence=excluded.confidence, limitations_json=excluded.limitations_json, evidence_signal_ids_json=excluded.evidence_signal_ids_json, methodology_version=excluded.methodology_version, updated_at=excluded.updated_at`)
    .bind(clusterId, workspaceId, email, cluster.key, cluster.title, cluster.summary, cluster.relevantItems, JSON.stringify(cluster.independentSourceTypes), cluster.startAt, cluster.endAt, cluster.momentumPercent, cluster.classification, cluster.classificationReason, JSON.stringify(cluster.geographyEvidence), cluster.purchaseIntentItems, cluster.alternativeSeekingItems, cluster.confidence, JSON.stringify(cluster.limitations), JSON.stringify(evidenceIds), MARKET_METHODOLOGY_VERSION, now, now).run();
  const score = await scoreForCluster(database, workspaceId, email, profile, cluster, allSignals);
  const opportunityExisting = await database.prepare("SELECT id FROM market_opportunities WHERE workspace_id = ? AND cluster_id = ? LIMIT 1").bind(workspaceId, clusterId).all<{ id: string }>();
  const opportunityId = opportunityExisting.results[0]?.id ?? crypto.randomUUID();
  const target = profile.targetCustomer || "the target customer described in the Market Profile"; const geography = cluster.geographyEvidence.join(", ") || profile.geography || "Geography not verified";
  const hypothesis = `${target} may respond to an offer that resolves this recurring problem: ${cluster.title.toLowerCase()}.`;
  const experiment = `Show two solution concepts to 20 target customers before building. Record each response and whether the person agrees to a paid trial or deposit.`;
  const success = "At least 6 of 20 customers select one concept, and at least 3 agree to a paid trial or deposit.";
  const conflicts = cluster.purchaseIntentItems ? [] : ["Discussion evidence does not yet include explicit purchase intent."];
  await database.prepare(`INSERT INTO market_opportunities (id, workspace_id, owner_key, cluster_id, title, customer_problem, target_customer, geography, lifecycle_status, hypothesis, validation_experiment, success_measure, evidence_summary_json, risks_json, conflicting_evidence_json, data_gaps_json, scores_json, time_range_start, time_range_end, discussions_analyzed, source_coverage, confidence, methodology_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'detected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, cluster_id) DO UPDATE SET title=excluded.title, customer_problem=excluded.customer_problem, target_customer=excluded.target_customer, geography=excluded.geography, hypothesis=excluded.hypothesis, validation_experiment=excluded.validation_experiment, success_measure=excluded.success_measure, evidence_summary_json=excluded.evidence_summary_json, risks_json=excluded.risks_json, conflicting_evidence_json=excluded.conflicting_evidence_json, data_gaps_json=excluded.data_gaps_json, scores_json=excluded.scores_json, time_range_start=excluded.time_range_start, time_range_end=excluded.time_range_end, discussions_analyzed=excluded.discussions_analyzed, source_coverage=excluded.source_coverage, confidence=excluded.confidence, methodology_version=excluded.methodology_version, updated_at=excluded.updated_at`)
    .bind(opportunityId, workspaceId, email, clusterId, cluster.title, cluster.summary, target, geography, hypothesis, experiment, success, JSON.stringify({ demand: `${cluster.relevantItems} relevant public items`, socialCommunity: cluster.independentSourceTypes, search: "No permitted search-interest source is configured", competitor: "Only recorded competitor observations are used", classification: cluster.classification, classificationReason: cluster.classificationReason }), JSON.stringify(["Public discussion may not translate into paid demand.", "The sample may overrepresent highly engaged online participants."]), JSON.stringify(conflicts), JSON.stringify(cluster.limitations), JSON.stringify(score), cluster.startAt, cluster.endAt, cluster.relevantItems, cluster.independentSourceTypes.length, cluster.confidence, MARKET_METHODOLOGY_VERSION, now, now).run();
  const changed = previous.results[0] && previous.results[0].classification !== cluster.classification && cluster.independentSourceTypes.length >= 2 && cluster.relevantItems >= 5;
  if (changed) {
    const week = new Date(cluster.endAt).toISOString().slice(0, 10);
    await database.prepare(`INSERT OR IGNORE INTO market_alerts (id, workspace_id, owner_key, fingerprint, alert_type, title, what_changed, compared_period, evidence_json, confidence, source_freshness, entity_reference, created_at) VALUES (?, ?, ?, ?, 'demand_shift', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), workspaceId, email, `${clusterId}:${cluster.classification}:${week}`, `Demand classification changed: ${cluster.title}`, `${previous.results[0].classification} → ${cluster.classification}`, `${new Date(cluster.startAt).toISOString().slice(0, 10)} to ${week}`, JSON.stringify({ relevantItems: cluster.relevantItems, sourceTypes: cluster.independentSourceTypes, momentumPercent: cluster.momentumPercent }), cluster.confidence, `Evidence measured through ${week}`, opportunityId, now).run();
  }
}

async function runResearch(database: Database, workspaceId: string, email: string, profile: ReturnType<typeof publicProfile>) {
  if (!profileComplete(profile)) throw new Response(JSON.stringify({ error: "Complete the Market Profile before collecting evidence" }), { status: 409, headers: { "content-type": "application/json" } });
  const recent = await database.prepare("SELECT id FROM market_collection_runs WHERE workspace_id = ? AND status = 'running' AND started_at >= ? LIMIT 1").bind(workspaceId, Date.now() - 120_000).all<{ id: string }>();
  if (recent.results[0]) throw new Response(JSON.stringify({ error: "A market collection is already running" }), { status: 409, headers: { "content-type": "application/json" } });
  const sources = await syncSourceRows(database, workspaceId, email); const available = sources.filter((source) => source.enabled && source.connector?.available);
  if (!available.length) throw new Response(JSON.stringify({ error: "No market sources are configured yet." }), { status: 409, headers: { "content-type": "application/json" } });
  const queryTerms = queryForProfile(profile); const query = queryTerms.join(" OR "); const runId = crypto.randomUUID(); const startedAt = Date.now();
  await database.prepare("INSERT INTO market_collection_runs (id, workspace_id, owner_key, status, stage, query_json, source_results_json, previous_report_preserved, started_at) VALUES (?, ?, ?, 'running', 'query_builder', ?, '[]', 1, ?)").bind(runId, workspaceId, email, JSON.stringify({ terms: queryTerms, geography: profile.geography }), startedAt).run();
  await database.prepare("UPDATE market_collection_runs SET stage = 'source_connectors' WHERE id = ?").bind(runId).run();
  const collected = await Promise.allSettled(available.map(async (source) => ({ source, signals: await collectPermittedMarketSignals(source.provider as MarketConnectorName, { query, geography: profile.geography }) })));
  const rawSignals = collected.flatMap((result) => result.status === "fulfilled" ? result.value.signals : []);
  const sourceResults = collected.map((result, index) => result.status === "fulfilled" ? { provider: result.value.source.provider, status: "completed", items: result.value.signals.length } : { provider: available[index].provider, status: "failed", items: 0, error: "Provider collection failed; the earlier report was preserved." });
  const failures = sourceResults.filter((item) => item.status === "failed"); const now = Date.now();
  for (const result of sourceResults) {
    await database.prepare("UPDATE market_sources SET status = ?, freshness_label = ?, last_success_at = ?, last_error_at = ?, last_error = ?, updated_at = ? WHERE workspace_id = ? AND provider = ?")
      .bind(result.status === "completed" ? "available" : "temporarily_unavailable", result.status === "completed" ? `${result.items} public items retrieved at ${new Date(now).toISOString()}` : "Latest collection failed; earlier evidence remains available", result.status === "completed" ? now : null, result.status === "failed" ? now : null, result.status === "failed" ? result.error : null, now, workspaceId, result.provider).run();
    if (result.status === "failed") await database.prepare(`INSERT OR IGNORE INTO market_alerts (id, workspace_id, owner_key, fingerprint, alert_type, title, what_changed, compared_period, evidence_json, confidence, source_freshness, created_at) VALUES (?, ?, ?, ?, 'source_failure', ?, ?, 'Latest collection', ?, 'high', ?, ?)`)
      .bind(crypto.randomUUID(), workspaceId, email, `${result.provider}:failure:${new Date(now).toISOString().slice(0, 10)}`, `${result.provider} source unavailable`, "The latest collection failed. Earlier evidence was not deleted.", JSON.stringify({ provider: result.provider }), "Collection failed at source connector stage", now).run();
  }
  if (!rawSignals.length) {
    await database.prepare("UPDATE market_collection_runs SET status = 'failed', stage = 'source_connectors', source_results_json = ?, completed_at = ? WHERE id = ?").bind(JSON.stringify(sourceResults), now, runId).run();
    throw new Response(JSON.stringify({ error: "Research failed to return permitted public evidence. The previous report was preserved.", sourceResults }), { status: 502, headers: { "content-type": "application/json" } });
  }
  await database.prepare("UPDATE market_collection_runs SET stage = 'deduplication_and_filtering', source_results_json = ? WHERE id = ?").bind(JSON.stringify(sourceResults), runId).run();
  const cleaned = cleanMarketSignals(rawSignals, queryTerms); cleaned.metrics.processingFailures = failures.length;
  const sourceIds = new Map(sources.map((source) => [source.provider, source.id])); const signalIds = new Map<string, string>();
  for (const signal of cleaned.signals) {
    const id = crypto.randomUUID(); signalIds.set(`${signal.provider}:${signal.externalId}`, id);
    await database.prepare(`INSERT INTO market_signals (id, workspace_id, owner_key, source_id, provider, source_type, external_id, public_url, title, excerpt, published_at, retrieved_at, language, geography, engagement_json, processing_version, content_hash, duplicate_status, promotion_status, relevance_status, problem_kinds_json, expiration_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, provider, external_id) DO UPDATE SET public_url=excluded.public_url, title=excluded.title, excerpt=excluded.excerpt, published_at=excluded.published_at, retrieved_at=excluded.retrieved_at, language=excluded.language, geography=excluded.geography, engagement_json=excluded.engagement_json, processing_version=excluded.processing_version, duplicate_status=excluded.duplicate_status, promotion_status=excluded.promotion_status, relevance_status=excluded.relevance_status, problem_kinds_json=excluded.problem_kinds_json, expiration_at=excluded.expiration_at, deleted_at=NULL`)
      .bind(id, workspaceId, email, sourceIds.get(signal.provider) ?? "unknown", signal.provider, signal.sourceType, signal.externalId, signal.publicUrl, signal.title, signal.excerpt, signal.publishedAt, signal.retrievedAt, signal.language, signal.geography ?? null, JSON.stringify(signal.engagement ?? {}), MARKET_PROCESSING_VERSION, signal.contentHash, signal.duplicate ? "duplicate" : "unique", signal.promotional ? "filtered_promotion" : "retained", signal.relevant ? "relevant" : "irrelevant", JSON.stringify(signal.problemKinds), signal.retrievedAt + 29 * 86_400_000, now).run();
    const stored = await database.prepare("SELECT id FROM market_signals WHERE workspace_id = ? AND provider = ? AND external_id = ? LIMIT 1").bind(workspaceId, signal.provider, signal.externalId).all<{ id: string }>();
    if (stored.results[0]) signalIds.set(`${signal.provider}:${signal.externalId}`, stored.results[0].id);
  }
  await database.prepare(`INSERT INTO market_cleaning_runs (id, collection_run_id, workspace_id, raw_items_collected, duplicates_removed, promotional_items_filtered, relevant_items_retained, languages_json, sources_json, processing_failures, processing_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), runId, workspaceId, cleaned.metrics.rawItemsCollected, cleaned.metrics.duplicatesRemoved, cleaned.metrics.promotionalItemsFiltered, cleaned.metrics.relevantItemsRetained, JSON.stringify(cleaned.metrics.languagesDetected), JSON.stringify(cleaned.metrics.sourcesRepresented), cleaned.metrics.processingFailures, MARKET_PROCESSING_VERSION, now).run();
  await database.prepare("UPDATE market_collection_runs SET stage = 'problem_clustering' WHERE id = ?").bind(runId).run();
  const clusters = buildProblemClusters(cleaned.signals);
  for (const cluster of clusters) await upsertClusterAndOpportunity(database, workspaceId, email, profile, cluster, signalIds, cleaned.signals);
  if (clusters.length) await database.prepare(`INSERT OR IGNORE INTO market_alerts (id, workspace_id, owner_key, fingerprint, alert_type, title, what_changed, compared_period, evidence_json, confidence, source_freshness, created_at) VALUES (?, ?, ?, ?, 'weekly_summary', 'Market evidence updated', ?, 'Latest collection', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), workspaceId, email, `weekly:${new Date(now).toISOString().slice(0, 8)}`, `${clusters.length} customer-problem ${clusters.length === 1 ? "cluster was" : "clusters were"} recalculated from permitted public evidence.`, JSON.stringify({ clusters: clusters.length, relevantItems: cleaned.metrics.relevantItemsRetained, sources: cleaned.metrics.sourcesRepresented }), clusters.some((cluster) => cluster.confidence === "high") ? "high" : clusters.some((cluster) => cluster.confidence === "medium") ? "medium" : "low", `Retrieved ${new Date(now).toISOString()}`, now).run();
  await database.prepare("UPDATE market_collection_runs SET status = ?, stage = 'human_review', source_results_json = ?, completed_at = ? WHERE id = ?").bind(failures.length ? "partial" : "completed", JSON.stringify(sourceResults), now, runId).run();
  await recordAuditEvent(database, { workspaceId, ownerKey: email, eventType: "market_research_completed", entityType: "market_collection_run", entityReference: runId, summary: `${cleaned.metrics.relevantItemsRetained} relevant public market items retained`, metadata: { sources: cleaned.metrics.sourcesRepresented, clusters: clusters.length, failures: failures.length, methodologyVersion: MARKET_METHODOLOGY_VERSION } });
}

export async function GET(request: Request) {
  const context = await prepare(request); if (!context) return unauthenticatedResponse();
  try { return Response.json(await loadPayload(context.database, context.workspace.id, context.email), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Market Intelligence is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request);
  if (rejected) return rejected;
  const context = await prepare(request); if (!context) return unauthenticatedResponse();
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  const action = typeof body.action === "string" ? body.action : ""; const { database, workspace, email } = context;
  const limited = await enforceRateLimit(database, email, "market:write", 20, 60_000); if (limited) return limited;
  try {
    const profileRow = await ensureProfile(database, workspace.id, email); const profile = publicProfile(profileRow); const now = Date.now();
    if (action === "save_profile") {
      const values = {
        industry: cleanText(body.industry, 120), productCategory: cleanText(body.productCategory, 120), targetCustomer: cleanText(body.targetCustomer, 180),
        customerAgeRange: cleanText(body.customerAgeRange, 80, true), geography: cleanText(body.geography, 120), channel: cleanText(body.channel, 20),
        pricePositioning: cleanText(body.pricePositioning, 80), currentProducts: cleanText(body.currentProducts, 300), expansionObjective: cleanText(body.expansionObjective, 240),
        experimentBudget: cleanText(body.experimentBudget, 80), monitoringFrequency: cleanText(body.monitoringFrequency, 20),
      };
      if (Object.entries(values).some(([key, value]) => key !== "customerAgeRange" && !value) || !CHANNELS.has(values.channel ?? "") || !FREQUENCIES.has(values.monitoringFrequency ?? "")) return Response.json({ error: "Complete each required Market Profile field" }, { status: 400 });
      await database.prepare(`UPDATE market_profiles SET industry=?, product_category=?, target_customer=?, customer_age_range=?, geography=?, channel=?, price_positioning=?, current_products=?, expansion_objective=?, experiment_budget=?, monitoring_frequency=?, status='complete', updated_at=? WHERE id=? AND owner_key=?`)
        .bind(values.industry, values.productCategory, values.targetCustomer, values.customerAgeRange || null, values.geography, values.channel, values.pricePositioning, values.currentProducts, values.expansionObjective, values.experimentBudget, values.monitoringFrequency, now, profile.id, email).run();
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "market_profile_saved", entityType: "market_profile", entityReference: profile.id, summary: "Market monitoring profile saved" });
    } else if (action === "set_books_fit") {
      if (typeof body.enabled !== "boolean") return Response.json({ error: "Choose whether ACC Books may be used for the separate Business Fit layer" }, { status: 400 });
      await database.prepare("UPDATE market_profiles SET books_fit_enabled = ?, updated_at = ? WHERE id = ? AND owner_key = ?").bind(body.enabled ? 1 : 0, now, profile.id, email).run();
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: body.enabled ? "market_books_fit_enabled" : "market_books_fit_disabled", entityType: "market_profile", entityReference: profile.id, summary: body.enabled ? "Owner permitted aggregated ACC Books calculations for Business Fit" : "Owner removed ACC Books permission from Market Intelligence" });
    } else if (action === "set_source_enabled") {
      if ((body.provider !== "reddit" && body.provider !== "youtube") || typeof body.enabled !== "boolean") return Response.json({ error: "Choose a supported source and state" }, { status: 400 });
      await database.prepare("UPDATE market_sources SET enabled = ?, updated_at = ? WHERE workspace_id = ? AND owner_key = ? AND provider = ?").bind(body.enabled ? 1 : 0, now, workspace.id, email, body.provider).run();
    } else if (action === "run_research") {
      await runResearch(database, workspace.id, email, profile);
    } else if (action === "set_opportunity_status") {
      if (!validId(body.opportunityId) || typeof body.status !== "string" || !LIFECYCLE.has(body.status)) return Response.json({ error: "Choose a valid opportunity and lifecycle state" }, { status: 400 });
      const rows = await database.prepare("SELECT lifecycle_status FROM market_opportunities WHERE id = ? AND workspace_id = ? AND owner_key = ? LIMIT 1").bind(body.opportunityId, workspace.id, email).all<{ lifecycle_status: string }>();
      const from = rows.results[0]?.lifecycle_status; if (!from) return Response.json({ error: "Opportunity not found" }, { status: 404 });
      const allowed: Record<string, string[]> = { detected: ["reviewed"], reviewed: ["saved"], saved: ["experiment_planned"], experiment_planned: ["experiment_running"], experiment_running: ["result_recorded"], result_recorded: ["launched", "rejected", "postponed"] };
      if (!(allowed[from] ?? []).includes(body.status)) return Response.json({ error: `Move this opportunity from ${from.replaceAll("_", " ")} to its next lifecycle stage first` }, { status: 409 });
      await database.prepare("UPDATE market_opportunities SET lifecycle_status=?, reviewed_at=CASE WHEN ?='reviewed' THEN ? ELSE reviewed_at END, saved_at=CASE WHEN ?='saved' THEN ? ELSE saved_at END, updated_at=? WHERE id=? AND workspace_id=? AND owner_key=?").bind(body.status, body.status, now, body.status, now, now, body.opportunityId, workspace.id, email).run();
      await database.prepare("INSERT INTO market_opportunity_events (id, opportunity_id, workspace_id, owner_key, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), body.opportunityId, workspace.id, email, from, body.status, cleanText(body.note, 300, true) || null, now).run();
    } else if (action === "create_experiment") {
      if (!validId(body.opportunityId) || !validDate(body.startDate) || !cleanText(body.description, 500)) return Response.json({ error: "Choose a saved opportunity, start date, and clear experiment" }, { status: 400 });
      const opportunities = await database.prepare("SELECT lifecycle_status FROM market_opportunities WHERE id=? AND workspace_id=? AND owner_key=? LIMIT 1").bind(body.opportunityId, workspace.id, email).all<{ lifecycle_status: string }>();
      if (opportunities.results[0]?.lifecycle_status !== "saved") return Response.json({ error: "Review and save the opportunity before planning an experiment" }, { status: 409 });
      const id = crypto.randomUUID(); const estimate = cleanInteger(body.estimatedResponseRateBps, 10_000);
      await database.prepare("INSERT INTO market_experiments (id, opportunity_id, workspace_id, owner_key, description, start_date, estimated_response_rate_bps, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)").bind(id, body.opportunityId, workspace.id, email, cleanText(body.description, 500), body.startDate, estimate, now, now).run();
      await database.prepare("UPDATE market_opportunities SET lifecycle_status='experiment_planned', updated_at=? WHERE id=?").bind(now, body.opportunityId).run();
      await database.prepare("INSERT INTO market_opportunity_events (id, opportunity_id, workspace_id, owner_key, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, 'saved', 'experiment_planned', ?, ?)").bind(crypto.randomUUID(), body.opportunityId, workspace.id, email, cleanText(body.description, 300), now).run();
    } else if (action === "update_experiment") {
      if (!validId(body.experimentId) || typeof body.status !== "string" || !["running", "result_recorded", "launched", "rejected", "postponed"].includes(body.status)) return Response.json({ error: "Choose a valid experiment update" }, { status: 400 });
      const rows = await database.prepare("SELECT opportunity_id, status FROM market_experiments WHERE id=? AND workspace_id=? AND owner_key=? LIMIT 1").bind(body.experimentId, workspace.id, email).all<{ opportunity_id: string; status: string }>();
      const experiment = rows.results[0]; if (!experiment) return Response.json({ error: "Experiment not found" }, { status: 404 });
      const experimentTransitions: Record<string, string[]> = { planned: ["running"], running: ["result_recorded"], result_recorded: ["launched", "rejected", "postponed"] };
      if (!(experimentTransitions[experiment.status] ?? []).includes(body.status)) return Response.json({ error: `Move this experiment from ${experiment.status.replaceAll("_", " ")} to its next stage first` }, { status: 409 });
      const numbers = ["customersContacted", "responses", "trialOrders", "trialRevenuePaise", "trialCostPaise", "returns", "complaints"] as const;
      const parsed = Object.fromEntries(numbers.map((key) => [key, cleanInteger(body[key], Number.MAX_SAFE_INTEGER)])) as Record<(typeof numbers)[number], number | null>;
      if (numbers.some((key) => parsed[key] === null) || (parsed.responses ?? 0) > (parsed.customersContacted ?? 0) || (parsed.trialOrders ?? 0) > (parsed.responses ?? 0)) return Response.json({ error: "Experiment counts and exact paise amounts are inconsistent" }, { status: 400 });
      const decision = ["launched", "rejected", "postponed"].includes(body.status) ? body.status : null;
      await database.prepare(`UPDATE market_experiments SET end_date=?, customers_contacted=?, responses=?, trial_orders=?, trial_revenue_paise=?, trial_cost_paise=?, returns_count=?, complaints_count=?, result=?, decision=?, notes=?, status=?, updated_at=? WHERE id=? AND workspace_id=? AND owner_key=?`)
        .bind(validDate(body.endDate) ? body.endDate : null, parsed.customersContacted, parsed.responses, parsed.trialOrders, parsed.trialRevenuePaise, parsed.trialCostPaise, parsed.returns, parsed.complaints, cleanText(body.result, 800, true) || null, decision, cleanText(body.notes, 1_000, true) || null, body.status, now, body.experimentId, workspace.id, email).run();
      const lifecycle = body.status === "running" ? "experiment_running" : body.status;
      const priorLifecycle = experiment.status === "planned" ? "experiment_planned" : experiment.status === "running" ? "experiment_running" : experiment.status;
      await database.prepare("UPDATE market_opportunities SET lifecycle_status=?, updated_at=? WHERE id=? AND workspace_id=? AND owner_key=?").bind(lifecycle, now, experiment.opportunity_id, workspace.id, email).run();
      await database.prepare("INSERT INTO market_opportunity_events (id, opportunity_id, workspace_id, owner_key, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), experiment.opportunity_id, workspace.id, email, priorLifecycle, lifecycle, cleanText(body.result, 300, true) || null, now).run();
    } else if (action === "add_competitor") {
      if (!cleanText(body.competitorName, 120) || !validHttpsUrl(body.sourceUrl) || !validDate(body.observedDate) || !cleanText(body.observation, 500) || !cleanText(body.inference, 500) || !["low", "medium", "high"].includes(String(body.confidence)) || !cleanText(body.limitation, 500)) return Response.json({ error: "Record the public source, observation, inference, confidence, and limitation" }, { status: 400 });
      await database.prepare("INSERT INTO market_competitor_insights (id, workspace_id, owner_key, competitor_name, source_url, observed_at, observation, inference, confidence, limitation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), workspace.id, email, cleanText(body.competitorName, 120), body.sourceUrl, Date.parse(`${body.observedDate}T00:00:00Z`), cleanText(body.observation, 500), cleanText(body.inference, 500), body.confidence, cleanText(body.limitation, 500), now).run();
    } else if (action === "dismiss_alert") {
      if (!validId(body.alertId)) return Response.json({ error: "Choose a valid alert" }, { status: 400 });
      await database.prepare("UPDATE market_alerts SET dismissed_at=? WHERE id=? AND workspace_id=? AND owner_key=?").bind(now, body.alertId, workspace.id, email).run();
    } else return Response.json({ error: "Unsupported Market Intelligence action" }, { status: 400 });
    return Response.json(await loadPayload(database, workspace.id, email), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Market Intelligence could not save this change" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
