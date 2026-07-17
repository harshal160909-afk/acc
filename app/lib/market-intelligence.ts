export const MARKET_METHODOLOGY_VERSION = "acc-market-v1.0.0";
export const MARKET_PROCESSING_VERSION = "acc-cleaning-v1.0.0";

export const MARKET_SCORE_WEIGHTS = Object.freeze({
  marketEvidence: 0.2,
  demandMomentum: 0.2,
  customerNeed: 0.2,
  competition: 0.1,
  businessFit: 0.2,
  executionReadiness: 0.1,
});

export type TrendClassification =
  | "Emerging"
  | "Accelerating"
  | "Stable"
  | "Declining"
  | "Seasonal"
  | "Viral but unproven"
  | "Competitor-driven"
  | "Recurring customer problem"
  | "Insufficient evidence";

export type ProblemKind =
  | "missing_feature"
  | "excessive_price"
  | "poor_availability"
  | "bad_quality"
  | "difficult_usage"
  | "inconvenient_format"
  | "unmet_segment"
  | "switching_behaviour"
  | "alternative_seeking"
  | "purchase_intention"
  | "repeat_complaint"
  | "product_comparison";

export type RawMarketSignal = {
  provider: string;
  externalId: string;
  publicUrl: string;
  sourceType: string;
  title: string;
  excerpt: string;
  publishedAt: number;
  retrievedAt: number;
  language?: string | null;
  geography?: string | null;
  engagement?: Record<string, number | string | boolean | null>;
};

export type CleanedMarketSignal = RawMarketSignal & {
  contentHash: string;
  language: string;
  duplicate: boolean;
  promotional: boolean;
  relevant: boolean;
  problemKinds: ProblemKind[];
  purchaseIntent: boolean;
  alternativeSeeking: boolean;
};

export type CleaningMetrics = {
  rawItemsCollected: number;
  duplicatesRemoved: number;
  promotionalItemsFiltered: number;
  relevantItemsRetained: number;
  languagesDetected: string[];
  sourcesRepresented: string[];
  processingFailures: number;
};

export type ProblemCluster = {
  key: ProblemKind;
  title: string;
  summary: string;
  relevantItems: number;
  independentSourceTypes: string[];
  startAt: number;
  endAt: number;
  momentumPercent: number | null;
  classification: TrendClassification;
  classificationReason: string;
  geographyEvidence: string[];
  purchaseIntentItems: number;
  alternativeSeekingItems: number;
  confidence: "low" | "medium" | "high";
  limitations: string[];
  representativeSignals: CleanedMarketSignal[];
};

const PROBLEM_META: Record<ProblemKind, { title: string; summary: string; patterns: RegExp[] }> = {
  missing_feature: { title: "A feature customers cannot find", summary: "People describe a capability they want but cannot find in current options.", patterns: [/wish (?:it|they) (?:had|offered)/i, /missing (?:a |the )?feature/i, /why (?:isn'?t|doesn'?t)/i, /needs? (?:a |an )/i] },
  excessive_price: { title: "The price feels too high", summary: "People repeatedly question the price or ask for a more affordable option.", patterns: [/too expensive/i, /overpriced/i, /cheaper (?:option|alternative)/i, /not worth (?:the )?(?:price|money)/i, /price is (?:high|crazy)/i] },
  poor_availability: { title: "Customers cannot reliably get it", summary: "Availability, delivery, or stock problems are blocking access.", patterns: [/out of stock/i, /not available/i, /can'?t find/i, /delivery (?:is )?(?:late|slow|unavailable)/i, /where can i (?:buy|get)/i] },
  bad_quality: { title: "Quality is disappointing", summary: "People describe defects, inconsistency, or an experience below expectations.", patterns: [/poor quality/i, /bad quality/i, /broke after/i, /doesn'?t work/i, /waste of money/i, /inconsistent/i] },
  difficult_usage: { title: "The product is difficult to use", summary: "Customers report confusing setup, instructions, or repeated friction.", patterns: [/hard to use/i, /difficult to use/i, /confusing/i, /complicated/i, /how do i/i, /instructions (?:are )?(?:bad|unclear)/i] },
  inconvenient_format: { title: "The format does not fit daily life", summary: "People want a more portable, smaller, faster, or easier format.", patterns: [/not portable/i, /too bulky/i, /smaller (?:pack|size|format)/i, /sachet/i, /travel[- ]friendly/i, /inconvenient/i] },
  unmet_segment: { title: "A customer segment feels overlooked", summary: "A specific group says existing products are not designed for its needs.", patterns: [/for (?:kids|women|men|seniors|students|beginners)/i, /not made for/i, /people like me/i, /no option for/i] },
  switching_behaviour: { title: "Customers are switching away", summary: "People describe leaving an existing product or brand for another option.", patterns: [/switched (?:to|from)/i, /moving (?:to|away)/i, /stopped buying/i, /never buying again/i, /replaced it with/i] },
  alternative_seeking: { title: "People are actively seeking alternatives", summary: "Customers explicitly ask for substitutes or better options.", patterns: [/any alternative/i, /better alternative/i, /looking for (?:an |a )?(?:alternative|replacement)/i, /what else can i use/i, /instead of/i] },
  purchase_intention: { title: "Customers show purchase intent", summary: "People ask where, when, or how they can buy a suitable option.", patterns: [/where can i buy/i, /i would buy/i, /ready to buy/i, /would pay/i, /take my money/i, /when (?:does|will) .* launch/i] },
  repeat_complaint: { title: "The same complaint keeps returning", summary: "People describe a recurring issue rather than a one-off incident.", patterns: [/again and again/i, /every time/i, /keeps? (?:happening|breaking|failing)/i, /same problem/i, /still hasn'?t fixed/i] },
  product_comparison: { title: "Customers are comparing current options", summary: "People compare products, features, price, or results before choosing.", patterns: [/ vs\.? /i, /versus/i, /which is better/i, /compared (?:with|to)/i, /difference between/i] },
};

const PROMOTION_PATTERNS = [
  /sponsored/i, /affiliate/i, /use (?:my|code)/i, /discount code/i,
  /limited[- ]time offer/i, /buy now/i, /shop now/i, /paid partnership/i,
];

function boundedText(value: string, maximum = 280) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function normalizeSignalText(value: string) {
  return boundedText(value, 1_000)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stableSignalHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function detectSignalLanguage(value: string) {
  const devanagari = (value.match(/[\u0900-\u097f]/g) ?? []).length;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  if (devanagari && latin) return "mixed Hindi/English";
  if (devanagari) return "Hindi";
  if (latin) return "English";
  return "unknown";
}

export function detectProblemKinds(value: string): ProblemKind[] {
  return (Object.entries(PROBLEM_META) as Array<[ProblemKind, (typeof PROBLEM_META)[ProblemKind]]>)
    .filter(([, meta]) => meta.patterns.some((pattern) => pattern.test(value)))
    .map(([kind]) => kind);
}

function queryMatches(value: string, queryTerms: readonly string[]) {
  if (!queryTerms.length) return true;
  const normalized = normalizeSignalText(value);
  return queryTerms.some((term) => normalized.includes(normalizeSignalText(term)));
}

export function cleanMarketSignals(rawSignals: readonly RawMarketSignal[], queryTerms: readonly string[]) {
  const seen = new Set<string>();
  const cleaned = rawSignals.map((signal): CleanedMarketSignal => {
    const title = boundedText(signal.title, 180);
    const excerpt = boundedText(signal.excerpt, 280);
    const combined = `${title} ${excerpt}`;
    const contentHash = stableSignalHash(normalizeSignalText(combined));
    const duplicate = seen.has(contentHash);
    seen.add(contentHash);
    const promotional = PROMOTION_PATTERNS.some((pattern) => pattern.test(combined));
    const problemKinds = detectProblemKinds(combined);
    const relevant = !duplicate && !promotional && queryMatches(combined, queryTerms);
    return {
      ...signal,
      title,
      excerpt,
      contentHash,
      language: signal.language?.trim() || detectSignalLanguage(combined),
      duplicate,
      promotional,
      relevant,
      problemKinds,
      purchaseIntent: problemKinds.includes("purchase_intention"),
      alternativeSeeking: problemKinds.includes("alternative_seeking"),
    };
  });
  const metrics: CleaningMetrics = {
    rawItemsCollected: rawSignals.length,
    duplicatesRemoved: cleaned.filter((item) => item.duplicate).length,
    promotionalItemsFiltered: cleaned.filter((item) => item.promotional && !item.duplicate).length,
    relevantItemsRetained: cleaned.filter((item) => item.relevant).length,
    languagesDetected: [...new Set(cleaned.map((item) => item.language))].sort(),
    sourcesRepresented: [...new Set(cleaned.map((item) => item.provider))].sort(),
    processingFailures: 0,
  };
  return { signals: cleaned, metrics };
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function confidenceFor(items: number, sources: number): ProblemCluster["confidence"] {
  if (items >= 12 && sources >= 3) return "high";
  if (items >= 5 && sources >= 2) return "medium";
  return "low";
}

function trendFor(items: readonly CleanedMarketSignal[], sourceCount: number) {
  if (items.length < 5 || sourceCount < 2) return {
    momentumPercent: null,
    classification: "Insufficient evidence" as const,
    reason: "Fewer than five relevant items or fewer than two independent source types were available.",
  };
  const times = items.map((item) => item.publishedAt).sort((a, b) => a - b);
  const midpoint = times[0] + ((times[times.length - 1] - times[0]) / 2);
  const earlier = items.filter((item) => item.publishedAt <= midpoint).length;
  const later = items.length - earlier;
  const momentumPercent = earlier === 0 ? (later > 0 ? 100 : 0) : Math.round(((later - earlier) / earlier) * 100);
  if (momentumPercent >= 80 && later >= 6) return { momentumPercent, classification: "Accelerating" as const, reason: "Relevant discussion volume in the later half of the measured period was at least 80% above the earlier half across multiple sources." };
  if (momentumPercent >= 25) return { momentumPercent, classification: "Emerging" as const, reason: "Relevant discussion volume strengthened in the later half of the measured period, with evidence from multiple source types." };
  if (momentumPercent <= -35) return { momentumPercent, classification: "Declining" as const, reason: "Relevant discussion volume was lower in the later half of the measured period." };
  return { momentumPercent, classification: "Stable" as const, reason: "Relevant discussion volume stayed within the stable range across the measured period." };
}

export function buildProblemClusters(signals: readonly CleanedMarketSignal[]): ProblemCluster[] {
  const usable = signals.filter((signal) => signal.relevant && signal.problemKinds.length > 0);
  return (Object.keys(PROBLEM_META) as ProblemKind[]).flatMap((kind): ProblemCluster[] => {
    const items = usable.filter((signal) => signal.problemKinds.includes(kind));
    if (!items.length) return [];
    const sourceTypes = [...new Set(items.map((item) => item.sourceType))].sort();
    const trend = trendFor(items, sourceTypes.length);
    const geographies = [...new Set(items.map((item) => item.geography).filter((value): value is string => Boolean(value)))].sort();
    const limitations: string[] = [];
    if (sourceTypes.length < 2) limitations.push("Only one source type contributed to this cluster.");
    if (items.length < 10) limitations.push("The sample is small and should be validated with direct customer research.");
    if (!geographies.length) limitations.push("Geography was not genuinely available for these items.");
    if (!items.some((item) => item.purchaseIntent)) limitations.push("No explicit purchase-intent language was detected.");
    return [{
      key: kind,
      title: PROBLEM_META[kind].title,
      summary: PROBLEM_META[kind].summary,
      relevantItems: items.length,
      independentSourceTypes: sourceTypes,
      startAt: Math.min(...items.map((item) => item.publishedAt)),
      endAt: Math.max(...items.map((item) => item.publishedAt)),
      momentumPercent: trend.momentumPercent,
      classification: trend.classification,
      classificationReason: trend.reason,
      geographyEvidence: geographies,
      purchaseIntentItems: items.filter((item) => item.purchaseIntent).length,
      alternativeSeekingItems: items.filter((item) => item.alternativeSeeking).length,
      confidence: confidenceFor(items.length, sourceTypes.length),
      limitations,
      representativeSignals: items.slice(0, 3),
    }];
  }).sort((a, b) => b.relevantItems - a.relevantItems);
}

export type ScoreInputs = {
  relevantItems: number;
  independentSources: number;
  averageSourceQuality: number;
  recentItemShare: number;
  geographicItemShare: number;
  momentumPercent: number | null;
  durationDays: number;
  recurrenceShare: number;
  painSeverity: number;
  purchaseIntentShare: number;
  alternativeSeekingShare: number;
  dissatisfactionShare: number;
  competitorCount: number;
  competitorMomentum: number;
  businessFitSignals?: number[] | null;
  executionSignals?: number[] | null;
  conflictingEvidenceShare: number;
  promotionalShare: number;
  missingSourceCount: number;
  geographyVerified: boolean;
  seasonalAmbiguity: boolean;
};

export function calculateTransparentOpportunityScore(input: ScoreInputs) {
  const sampleSufficiency = clamp(input.relevantItems * 4);
  const marketEvidence = clamp((
    clamp(input.averageSourceQuality) +
    clamp(input.independentSources * 32) +
    sampleSufficiency +
    clamp(input.recentItemShare * 100) +
    clamp(input.geographicItemShare * 100)
  ) / 5);
  const demandMomentum = clamp((
    clamp((input.momentumPercent ?? 0) + 50) +
    clamp(input.relevantItems / Math.max(1, input.durationDays) * 450) +
    clamp(input.durationDays * 2) +
    clamp(input.recurrenceShare * 100)
  ) / 4);
  const customerNeed = clamp((
    clamp(input.painSeverity) +
    clamp(input.recurrenceShare * 100) +
    clamp(input.alternativeSeekingShare * 100) +
    clamp(input.purchaseIntentShare * 100) +
    clamp(input.dissatisfactionShare * 100)
  ) / 5);
  const competition = clamp(100 - Math.min(80, input.competitorCount * 12) - clamp(input.competitorMomentum) * 0.2);
  const businessFit = input.businessFitSignals?.length
    ? clamp(input.businessFitSignals.reduce((total, value) => total + clamp(value), 0) / input.businessFitSignals.length)
    : null;
  const executionReadiness = input.executionSignals?.length
    ? clamp(input.executionSignals.reduce((total, value) => total + clamp(value), 0) / input.executionSignals.length)
    : null;
  const uncertaintyPenalty = clamp((
    Math.min(100, input.missingSourceCount * 18) +
    clamp(input.conflictingEvidenceShare * 100) +
    (input.relevantItems < 10 ? 70 : input.relevantItems < 25 ? 35 : 10) +
    clamp(input.promotionalShare * 100) +
    (input.geographyVerified ? 0 : 55) +
    (input.seasonalAmbiguity ? 60 : 0)
  ) / 6);
  const canCombine = input.relevantItems >= 5 && input.independentSources >= 2 && businessFit !== null && executionReadiness !== null;
  const combined = canCombine ? clamp(
    marketEvidence * MARKET_SCORE_WEIGHTS.marketEvidence +
    demandMomentum * MARKET_SCORE_WEIGHTS.demandMomentum +
    customerNeed * MARKET_SCORE_WEIGHTS.customerNeed +
    competition * MARKET_SCORE_WEIGHTS.competition +
    businessFit * MARKET_SCORE_WEIGHTS.businessFit +
    executionReadiness * MARKET_SCORE_WEIGHTS.executionReadiness -
    uncertaintyPenalty * 0.25,
  ) : null;
  return {
    methodologyVersion: MARKET_METHODOLOGY_VERSION,
    weights: MARKET_SCORE_WEIGHTS,
    components: { marketEvidence, demandMomentum, customerNeed, competition, businessFit, executionReadiness, uncertaintyPenalty },
    combined,
    combinedUnavailableReason: canCombine ? null : "A combined score requires at least five relevant items, two independent source types, explicit ACC Books permission, and execution inputs.",
  };
}

export function forecastingGate(input: { durationDays: number; independentSources: number; relevantItems: number; stableRuns: number; missingDataShare: number; backtestReady: boolean }) {
  const requirements = [
    { label: "At least 90 days of history", met: input.durationDays >= 90 },
    { label: "At least three independent source types", met: input.independentSources >= 3 },
    { label: "At least 100 relevant items", met: input.relevantItems >= 100 },
    { label: "At least eight stable collection runs", met: input.stableRuns >= 8 },
    { label: "Missing-data level at or below 10%", met: input.missingDataShare <= 0.1 },
    { label: "Backtested methodology", met: input.backtestReady },
  ];
  return { enabled: requirements.every((item) => item.met), requirements };
}

export function calculateExperimentEvaluation(experiments: readonly { opportunityId: string; status: string; decision: string | null; startDate: string; endDate: string | null; estimatedResponseRateBps: number | null; customersContacted: number; responses: number }[]) {
  const tested = experiments.filter((experiment) => ["result_recorded", "launched", "rejected", "postponed"].includes(experiment.status));
  const completedDays = tested.flatMap((experiment) => experiment.endDate ? [Math.max(0, Math.round((Date.parse(experiment.endDate) - Date.parse(experiment.startDate)) / 86_400_000))] : []);
  const actualRates = tested.flatMap((experiment) => experiment.customersContacted > 0 ? [Math.round(experiment.responses / experiment.customersContacted * 10_000)] : []);
  const estimatedRates = tested.flatMap((experiment) => experiment.estimatedResponseRateBps === null ? [] : [experiment.estimatedResponseRateBps]);
  return {
    opportunitiesTested: new Set(tested.map((experiment) => experiment.opportunityId)).size,
    positiveExperiments: tested.filter((experiment) => experiment.decision === "launched").length,
    falsePositiveSignals: tested.filter((experiment) => experiment.decision === "rejected").length,
    rejectedOpportunities: tested.filter((experiment) => experiment.decision === "rejected").length,
    averageValidationDays: completedDays.length ? Math.round(completedDays.reduce((a, b) => a + b, 0) / completedDays.length) : null,
    averageEstimatedResponseRateBps: estimatedRates.length ? Math.round(estimatedRates.reduce((a, b) => a + b, 0) / estimatedRates.length) : null,
    averageActualResponseRateBps: actualRates.length ? Math.round(actualRates.reduce((a, b) => a + b, 0) / actualRates.length) : null,
  };
}
