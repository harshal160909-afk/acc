import { getRequestIdentity, unauthenticatedResponse } from "@/app/lib/server/access";
import { ensureStore, getDatabase, recordAuditEvent, resolveWorkspace } from "@/app/lib/server/context";
import { computePortfolioAnalytics, investmentCashEffect, multiplyPriceByQuantity, parseQuantityMicros, type InvestmentTransactionType } from "@/app/lib/investments";
import { fetchLicensedQuote, readMarketConfig } from "@/app/lib/market/provider";
import { enforceRateLimit, validateJsonMutation } from "@/app/lib/server/http-security";

type PortfolioRow = { id: string; name: string; portfolio_type: string; currency: string; is_paper: number; guardian_managed: number; created_at: number; updated_at: number };
type TransactionRow = { id: string; portfolio_id: string; security_id: string | null; transaction_type: InvestmentTransactionType; trade_date: string; quantity_micros: number | null; price_paise: number | null; amount_paise: number; fees_paise: number; taxes_paise: number; note: string | null; provenance_json: string; created_at: number; symbol: string | null; exchange: string | null; security_name: string | null; asset_class: string | null };
type SecurityRow = { id: string; symbol: string; exchange: string; name: string; asset_class: string; sector: string | null; currency: string; source: string };
type PriceRow = { security_id: string; price_paise: number; source: string; observed_at: number; retrieved_at: number; delay_minutes: number; licensing_status: string };

const TYPES = new Set<InvestmentTransactionType>(["buy", "sell", "dividend", "interest", "deposit", "withdrawal", "fee", "tax", "adjustment"]);
const SECURITY_TYPES = new Set<InvestmentTransactionType>(["buy", "sell"]);

function cleanText(value: unknown, max: number, required = true) {
  if (typeof value !== "string") return required ? null : "";
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}
function paise(value: unknown, allowZero = false) {
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0) ? value : null;
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
function validId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value); }
function validOperationKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(value); }

function investmentError(code: string, stage: string, message: string, status: number, retryable = status >= 500) {
  return Response.json({ code, stage, error: message, retryable }, { status, headers: { "Cache-Control": "no-store" } });
}

// A prepared audit-event insert, so it can be committed in the same atomic
// D1 batch as the write it describes (never a separate, un-rolled-back write).
function auditStatement(
  database: Awaited<ReturnType<typeof getDatabase>>,
  input: { workspaceId: string; ownerKey: string; eventType: string; entityType: string; entityReference: string; summary: string; metadata?: Record<string, unknown> },
) {
  return database.prepare(`INSERT INTO audit_events (id, workspace_id, owner_key, event_type, entity_type, entity_reference, summary, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), input.workspaceId, input.ownerKey, input.eventType, input.entityType,
    input.entityReference, input.summary, input.metadata ? JSON.stringify(input.metadata) : null, Date.now(),
  );
}

// Commit a set of statements atomically when D1 batch is available, else run
// them in order (single-binding local/dev fallback).
async function commit(database: Awaited<ReturnType<typeof getDatabase>>, statements: ReturnType<typeof auditStatement>[]) {
  if (database.batch) await database.batch(statements);
  else for (const statement of statements) await statement.run();
}

async function ownedPortfolio(database: Awaited<ReturnType<typeof getDatabase>>, ownerKey: string, id: string) {
  const rows = await database.prepare("SELECT id, workspace_id FROM portfolios WHERE id = ? AND owner_key = ? AND archived_at IS NULL LIMIT 1")
    .bind(id, ownerKey).all<{ id: string; workspace_id: string }>();
  return rows.results[0] ?? null;
}

async function getOrCreateSecurity(database: Awaited<ReturnType<typeof getDatabase>>, input: Record<string, unknown>) {
  const symbol = cleanText(input.symbol, 24)?.toUpperCase();
  const exchange = cleanText(input.exchange, 24)?.toUpperCase();
  const name = cleanText(input.securityName, 120);
  const assetClass = cleanText(input.assetClass, 40);
  if (!symbol || !exchange || !name || !assetClass) return null;
  // Race-safe: INSERT OR IGNORE against the unique (symbol,exchange) index, then
  // read back the canonical row. Two concurrent requests for the same security
  // converge on one id instead of racing a SELECT-then-INSERT.
  const id = crypto.randomUUID();
  const now = Date.now();
  await database.prepare(`INSERT OR IGNORE INTO securities (id, symbol, exchange, name, asset_class, sector, currency, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'INR', 'manual', ?, ?)`)
    .bind(id, symbol, exchange, name, assetClass, cleanText(input.sector, 80, false) || null, now, now).run();
  const canonical = await database.prepare("SELECT id FROM securities WHERE symbol = ? AND exchange = ? LIMIT 1")
    .bind(symbol, exchange).all<{ id: string }>();
  return canonical.results[0]?.id ?? null;
}

const RECENT_TRANSACTION_LIMIT = 20;
const TRANSACTION_PAGE_SIZE = 50;

async function portfolioPayload(database: Awaited<ReturnType<typeof getDatabase>>, email: string, workspaceId: string) {
  const [portfoliosResult, transactionsResult, securitiesResult, watchlistResult, marketConfig] = await Promise.all([
    database.prepare(`SELECT id, name, portfolio_type, currency, is_paper, guardian_managed, created_at, updated_at
      FROM portfolios WHERE owner_key = ? AND workspace_id = ? AND archived_at IS NULL ORDER BY updated_at DESC`).bind(email, workspaceId).all<PortfolioRow>(),
    database.prepare(`SELECT t.id, t.portfolio_id, t.security_id, t.transaction_type, t.trade_date, t.quantity_micros,
      t.price_paise, t.amount_paise, t.fees_paise, t.taxes_paise, t.note, t.provenance_json, t.created_at,
      s.symbol, s.exchange, s.name AS security_name, s.asset_class
      FROM investment_transactions t LEFT JOIN securities s ON s.id = t.security_id
      WHERE t.owner_key = ? AND t.workspace_id = ? ORDER BY t.trade_date ASC, t.created_at ASC`).bind(email, workspaceId).all<TransactionRow>(),
    database.prepare(`SELECT DISTINCT s.id, s.symbol, s.exchange, s.name, s.asset_class, s.sector, s.currency, s.source
      FROM securities s LEFT JOIN investment_transactions t ON t.security_id = s.id LEFT JOIN watchlist_items w ON w.security_id = s.id
      WHERE (t.owner_key = ? AND t.workspace_id = ?) OR (w.owner_key = ? AND w.workspace_id = ?)
      ORDER BY s.symbol`).bind(email, workspaceId, email, workspaceId).all<SecurityRow>(),
    database.prepare(`SELECT w.id, w.security_id, w.note, w.created_at, s.symbol, s.exchange, s.name
      FROM watchlist_items w JOIN securities s ON s.id = w.security_id
      WHERE w.owner_key = ? AND w.workspace_id = ? ORDER BY w.created_at DESC`).bind(email, workspaceId).all(),
    readMarketConfig(),
  ]);

  // Price lookups are scoped to only the securities this workspace actually
  // references — never a global "latest price per security" scan.
  const relevantSecurityIds = securitiesResult.results.map((row) => row.id);
  const { latestPrice, manualPriceCount } = await loadRelevantPrices(database, email, workspaceId, relevantSecurityIds);

  // Group transactions by portfolio in a single pass (O(transactions)), instead
  // of filtering the whole array once per portfolio (O(portfolios × transactions)).
  const byPortfolio = new Map<string, TransactionRow[]>();
  for (const row of transactionsResult.results) {
    const list = byPortfolio.get(row.portfolio_id) ?? [];
    list.push(row);
    byPortfolio.set(row.portfolio_id, list);
  }

  const portfolioSummaries = portfoliosResult.results.map((portfolio) => {
    const rows = byPortfolio.get(portfolio.id) ?? [];
    const priceBySecurity = new Map<string, number>();
    for (const row of rows) {
      if (row.security_id && latestPrice.has(row.security_id)) priceBySecurity.set(row.security_id, latestPrice.get(row.security_id)!.price_paise);
    }
    const analytics = computePortfolioAnalytics(
      rows.map((row) => ({ transactionType: row.transaction_type, tradeDate: row.trade_date, securityId: row.security_id, quantityMicros: row.quantity_micros, amountPaise: row.amount_paise, feesPaise: row.fees_paise, taxesPaise: row.taxes_paise })),
      priceBySecurity,
    );
    let cashPaise = 0;
    const meta = new Map<string, { symbol: string; exchange: string; name: string; assetClass: string }>();
    for (const row of rows) {
      cashPaise += investmentCashEffect(row.transaction_type, row.amount_paise, row.fees_paise, row.taxes_paise);
      if (row.security_id) meta.set(row.security_id, { symbol: row.symbol ?? "—", exchange: row.exchange ?? "—", name: row.security_name ?? "Unnamed security", assetClass: row.asset_class ?? "other" });
    }
    const holdings = Object.values(analytics.basisBySecurity).map((basis) => {
      const info = meta.get(basis.securityId) ?? { symbol: "—", exchange: "—", name: "Unnamed security", assetClass: "other" };
      const price = latestPrice.get(basis.securityId);
      const currentValuePaise = price ? multiplyPriceByQuantity(price.price_paise, basis.quantityMicros) : null;
      return {
        securityId: basis.securityId, symbol: info.symbol, exchange: info.exchange, name: info.name, assetClass: info.assetClass,
        quantityMicros: basis.quantityMicros, investedPaise: basis.costBasisPaise, costBasisPaise: basis.costBasisPaise,
        currentValuePaise,
        unrealizedGainPaise: currentValuePaise === null ? null : currentValuePaise - basis.costBasisPaise,
        price: price ? { pricePaise: price.price_paise, source: price.source, observedAt: price.observed_at, retrievedAt: price.retrieved_at, delayMinutes: price.delay_minutes, licensingStatus: price.licensing_status } : null,
      };
    });
    const holdingsValuePaise = holdings.reduce((sum, holding) => sum + (holding.currentValuePaise ?? 0), 0);
    return {
      ...portfolio, isPaper: Boolean(portfolio.is_paper), guardianManaged: Boolean(portfolio.guardian_managed),
      cashPaise, holdingsValuePaise, totalValuePaise: analytics.totalValuePaise, valuationStatus: analytics.valuationStatus,
      holdings,
      analytics: {
        methodology: "weighted_average",
        netExternalCashFlowPaise: analytics.netExternalCashFlowPaise,
        cashContributedPaise: analytics.cashContributedPaise,
        cashWithdrawnPaise: analytics.cashWithdrawnPaise,
        costBasisPaise: analytics.costBasisPaise,
        realizedGainPaise: analytics.realizedGainPaise,
        unrealizedGainPaise: analytics.unrealizedGainPaise,
        dividendsInterestPaise: analytics.dividendsInterestPaise,
        feesTaxesPaise: analytics.feesTaxesPaise,
        totalValuePaise: analytics.totalValuePaise,
        xirrBps: analytics.xirrBps,
        xirrUnavailableReason: analytics.xirrUnavailableReason,
      },
      transactionCount: rows.length,
      recentTransactions: rows.slice(-RECENT_TRANSACTION_LIMIT).reverse(),
    };
  });
  return { portfolios: portfolioSummaries, securities: securitiesResult.results, watchlist: watchlistResult.results, marketConfigured: marketConfig.configured, marketProvider: marketConfig.configured ? marketConfig.provider : null, dataStatus: marketConfig.configured ? "licensed_source_configured" : manualPriceCount ? "manual_prices_available" : "no_market_source_configured", freshness: { calculatedAt: Date.now(), pricePolicy: "Only your workspace's manual prices or shared licensed-provider prices are used. Missing prices remain unavailable." } };
}

// Latest price per security, restricted to the given relevant security ids.
async function loadRelevantPrices(
  database: Awaited<ReturnType<typeof getDatabase>>,
  email: string,
  workspaceId: string,
  securityIds: string[],
) {
  const latestPrice = new Map<string, PriceRow>();
  if (!securityIds.length) return { latestPrice, manualPriceCount: 0 };
  const placeholders = securityIds.map(() => "?").join(",");
  const [licensed, manual] = await Promise.all([
    database.prepare(`SELECT p.security_id, p.price_paise, p.source, p.observed_at, p.retrieved_at, p.delay_minutes, p.licensing_status
      FROM price_snapshots p INNER JOIN (
        SELECT security_id, MAX(observed_at) observed_at FROM price_snapshots WHERE security_id IN (${placeholders}) GROUP BY security_id
      ) latest ON latest.security_id = p.security_id AND latest.observed_at = p.observed_at
      WHERE p.security_id IN (${placeholders}) AND p.source <> 'user_manual' AND p.licensing_status <> 'user_supplied'`)
      .bind(...securityIds, ...securityIds).all<PriceRow>(),
    database.prepare(`SELECT m.security_id, m.price_paise, 'user_manual' AS source,
      m.observed_at, m.observed_at AS retrieved_at, 0 AS delay_minutes, 'user_supplied' AS licensing_status
      FROM manual_price_snapshots m INNER JOIN (
        SELECT security_id, MAX(observed_at) observed_at FROM manual_price_snapshots
        WHERE owner_key = ? AND workspace_id = ? AND security_id IN (${placeholders}) GROUP BY security_id
      ) latest ON latest.security_id = m.security_id AND latest.observed_at = m.observed_at
      WHERE m.owner_key = ? AND m.workspace_id = ?`).bind(email, workspaceId, ...securityIds, email, workspaceId).all<PriceRow>(),
  ]);
  for (const row of licensed.results) latestPrice.set(row.security_id, row);
  for (const row of manual.results) {
    const shared = latestPrice.get(row.security_id);
    if (!shared || row.observed_at >= shared.observed_at) latestPrice.set(row.security_id, row);
  }
  return { latestPrice, manualPriceCount: manual.results.length };
}

// Cursor-paginated transaction history for one portfolio (newest first).
async function listTransactions(
  database: Awaited<ReturnType<typeof getDatabase>>,
  email: string,
  portfolioId: string,
  beforeCreatedAt: number | null,
) {
  const rows = await database.prepare(`SELECT t.id, t.portfolio_id, t.security_id, t.transaction_type, t.trade_date, t.quantity_micros,
    t.price_paise, t.amount_paise, t.fees_paise, t.taxes_paise, t.note, t.provenance_json, t.created_at,
    s.symbol, s.exchange, s.name AS security_name, s.asset_class
    FROM investment_transactions t LEFT JOIN securities s ON s.id = t.security_id
    WHERE t.owner_key = ? AND t.portfolio_id = ? AND (? IS NULL OR t.created_at < ?)
    ORDER BY t.created_at DESC LIMIT ?`)
    .bind(email, portfolioId, beforeCreatedAt, beforeCreatedAt, TRANSACTION_PAGE_SIZE + 1).all<TransactionRow>();
  const page = rows.results.slice(0, TRANSACTION_PAGE_SIZE);
  const hasMore = rows.results.length > TRANSACTION_PAGE_SIZE;
  return { transactions: page, nextCursor: hasMore ? page[page.length - 1]?.created_at ?? null : null, hasMore };
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;
  const url = new URL(request.url);
  const started = Date.now();
  try {
    const database = await getDatabase(); await ensureStore(database); const workspace = await resolveWorkspace(database, email);
    // Paginated transaction history for one portfolio.
    const portfolioId = url.searchParams.get("portfolioId");
    if (portfolioId) {
      if (!validId(portfolioId)) return Response.json({ error: "Choose a valid portfolio" }, { status: 400 });
      const portfolio = await ownedPortfolio(database, email, portfolioId);
      if (!portfolio || portfolio.workspace_id !== workspace.id) return Response.json({ error: "Portfolio not found" }, { status: 404 });
      const beforeRaw = url.searchParams.get("before");
      const before = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
      return Response.json(await listTransactions(database, email, portfolioId, before), { headers: { "Cache-Control": "no-store" } });
    }
    const payload = await portfolioPayload(database, email, workspace.id);
    return Response.json(payload, { headers: { "Cache-Control": "no-store", "Server-Timing": `inv;dur=${Date.now() - started}` } });
  } catch { return investmentError("INVESTMENT_LOAD_FAILED", "load", "Investment records are unavailable", 503); }
}

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request);
  if (rejected) return rejected;
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  let stage = "validating input";
  try {
    const database = await getDatabase(); await ensureStore(database);
    const limited = await enforceRateLimit(database, email, "investments:write", 30, 60_000); if (limited) return limited;
    const workspace = await resolveWorkspace(database, email); const now = Date.now();
    let createdPortfolioId: string | null = null;
    if (body.action === "create_portfolio") {
      const name = cleanText(body.name, 80); if (!name) return Response.json({ error: "Give the portfolio a clear name" }, { status: 400 });
      const id = crypto.randomUUID();
      stage = "saving portfolio";
      await commit(database, [
        database.prepare(`INSERT INTO portfolios (id, workspace_id, owner_key, name, portfolio_type, currency, is_paper, guardian_managed, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?)`)
          .bind(id, workspace.id, email, name, cleanText(body.portfolioType, 30, false) || "personal", body.isPaper === true ? 1 : 0, body.guardianManaged === true ? 1 : 0, now, now),
        auditStatement(database, { workspaceId: workspace.id, ownerKey: email, eventType: "portfolio_created", entityType: "portfolio", entityReference: id, summary: `Portfolio created: ${name}` }),
      ]);
      createdPortfolioId = id;
    } else if (body.action === "add_transaction") {
      if (!validId(body.portfolioId) || !validOperationKey(body.idempotencyKey) || !validDate(body.tradeDate) || typeof body.transactionType !== "string" || !TYPES.has(body.transactionType as InvestmentTransactionType)) return Response.json({ error: "Complete the valid investment transaction details" }, { status: 400 });
      const portfolio = await ownedPortfolio(database, email, body.portfolioId); if (!portfolio || portfolio.workspace_id !== workspace.id) return Response.json({ error: "Portfolio not found" }, { status: 404 });
      const existing = await database.prepare("SELECT id FROM investment_transactions WHERE owner_key = ? AND idempotency_key = ? LIMIT 1").bind(email, body.idempotencyKey).all<{ id: string }>();
      if (existing.results[0]) return Response.json(await portfolioPayload(database, email, workspace.id), { status: 200, headers: { "Cache-Control": "no-store" } });
      const transactionType = body.transactionType as InvestmentTransactionType;
      const amountPaise = paise(body.amountPaise); const feesPaise = paise(body.feesPaise, true); const taxesPaise = paise(body.taxesPaise, true);
      if (amountPaise === null || feesPaise === null || taxesPaise === null || !Number.isSafeInteger(amountPaise + feesPaise + taxesPaise)) return Response.json({ error: "Enter exact positive amounts in paise" }, { status: 400 });
      let securityId: string | null = null; let quantityMicros: number | null = null; let pricePaise: number | null = null;
      if (SECURITY_TYPES.has(transactionType)) {
        securityId = await getOrCreateSecurity(database, body); quantityMicros = parseQuantityMicros(body.quantity); pricePaise = paise(body.pricePaise);
        if (!securityId || quantityMicros === null || pricePaise === null) return Response.json({ error: "Security, quantity, and price are required for this transaction" }, { status: 400 });
        const calculated = multiplyPriceByQuantity(pricePaise, quantityMicros);
        if (calculated !== amountPaise) return Response.json({ error: "Amount must exactly equal quantity multiplied by price" }, { status: 400 });
        if (transactionType === "sell") {
          const position = await database.prepare(`SELECT COALESCE(SUM(CASE WHEN transaction_type = 'buy' THEN quantity_micros WHEN transaction_type = 'sell' THEN -quantity_micros ELSE 0 END), 0) AS available_quantity_micros FROM investment_transactions WHERE portfolio_id = ? AND owner_key = ? AND security_id = ?`)
            .bind(portfolio.id, email, securityId).all<{ available_quantity_micros: number }>();
          const availableQuantityMicros = position.results[0]?.available_quantity_micros ?? 0;
          if (quantityMicros > availableQuantityMicros) return Response.json({ error: "You cannot sell more units than this portfolio currently holds" }, { status: 409 });
        }
      }
      const id = crypto.randomUUID();
      // Transaction insert, portfolio timestamp and audit event commit as one
      // atomic batch — a partial failure never leaves contradictory records.
      stage = "saving transaction";
      await commit(database, [
        database.prepare(`INSERT INTO investment_transactions (id, portfolio_id, workspace_id, owner_key, security_id, transaction_type, trade_date, quantity_micros, price_paise, amount_paise, fees_paise, taxes_paise, note, provenance_json, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, portfolio.id, workspace.id, email, securityId, transactionType, body.tradeDate, quantityMicros, pricePaise, amountPaise, feesPaise, taxesPaise, cleanText(body.note, 300, false) || null, JSON.stringify({ schemaVersion: 10, source: "user_manual", recordedByUserId: identity.userId }), body.idempotencyKey, now),
        database.prepare("UPDATE portfolios SET updated_at = ? WHERE id = ?").bind(now, portfolio.id),
        auditStatement(database, { workspaceId: workspace.id, ownerKey: email, eventType: "investment_transaction_recorded", entityType: "investment_transaction", entityReference: id, summary: `Manual ${transactionType} recorded`, metadata: { portfolioId: portfolio.id, amountPaise } }),
      ]);
    } else if (body.action === "set_manual_price") {
      if (!validId(body.securityId) || paise(body.pricePaise) === null) return Response.json({ error: "Choose a security and enter a positive exact price" }, { status: 400 });
      const allowed = await database.prepare(`SELECT s.id FROM securities s LEFT JOIN investment_transactions t ON t.security_id = s.id LEFT JOIN watchlist_items w ON w.security_id = s.id WHERE s.id = ? AND ((t.owner_key = ? AND t.workspace_id = ?) OR (w.owner_key = ? AND w.workspace_id = ?)) LIMIT 1`).bind(body.securityId, email, workspace.id, email, workspace.id).all<{ id: string }>();
      if (!allowed.results[0]) return Response.json({ error: "Security not found in your workspace" }, { status: 404 });
      const observedAt = typeof body.observedAt === "number" && Number.isSafeInteger(body.observedAt) && body.observedAt <= now ? body.observedAt : now;
      stage = "saving price";
      await commit(database, [
        database.prepare(`INSERT INTO manual_price_snapshots (id, security_id, workspace_id, owner_key, price_paise, currency, observed_at, created_at) VALUES (?, ?, ?, ?, ?, 'INR', ?, ?)`)
          .bind(crypto.randomUUID(), body.securityId, workspace.id, email, body.pricePaise, observedAt, now),
        auditStatement(database, { workspaceId: workspace.id, ownerKey: email, eventType: "manual_price_recorded", entityType: "security", entityReference: body.securityId as string, summary: "User-entered security price recorded", metadata: { pricePaise: body.pricePaise, observedAt } }),
      ]);
    } else if (body.action === "refresh_prices") {
      if (!validId(body.portfolioId)) return Response.json({ error: "Choose a portfolio to refresh" }, { status: 400 });
      const portfolio = await ownedPortfolio(database, email, body.portfolioId); if (!portfolio || portfolio.workspace_id !== workspace.id) return Response.json({ error: "Portfolio not found" }, { status: 404 });
      const market = await readMarketConfig(); if (!market.configured) return Response.json({ error: "A licensed market provider must be configured in the hosting secret manager first" }, { status: 409 });
      const recent = await database.prepare("SELECT id FROM sync_runs WHERE workspace_id = ? AND started_at >= ? LIMIT 1").bind(workspace.id, now - 30_000).all<{ id: string }>();
      if (recent.results[0]) return Response.json({ error: "Please wait before refreshing market prices again" }, { status: 429 });
      const sourceRows = await database.prepare("SELECT id FROM data_sources WHERE workspace_id = ? AND owner_key = ? AND kind = 'market_quotes' AND provider = ? LIMIT 1").bind(workspace.id, email, market.provider).all<{ id: string }>();
      const dataSourceId = sourceRows.results[0]?.id ?? crypto.randomUUID();
      if (!sourceRows.results[0]) await database.prepare(`INSERT INTO data_sources (id, workspace_id, owner_key, kind, provider, status, freshness_label, updated_at) VALUES (?, ?, ?, 'market_quotes', ?, 'configured', 'No successful quote sync yet', ?)`)
        .bind(dataSourceId, workspace.id, email, market.provider, now).run();
      const syncId = crypto.randomUUID(); await database.prepare("INSERT INTO sync_runs (id, data_source_id, workspace_id, status, started_at) VALUES (?, ?, ?, 'running', ?)").bind(syncId, dataSourceId, workspace.id, now).run();
      const securityRows = await database.prepare(`SELECT DISTINCT s.id, s.symbol, s.exchange FROM securities s JOIN investment_transactions t ON t.security_id = s.id WHERE t.portfolio_id = ? AND t.owner_key = ? LIMIT 25`)
        .bind(portfolio.id, email).all<{ id: string; symbol: string; exchange: string }>();
      const results = await Promise.allSettled(securityRows.results.map(async (security) => ({ security, quote: await fetchLicensedQuote(security.symbol, security.exchange) })));
      let savedCount = 0; const failures: string[] = [];
      for (const result of results) {
        if (result.status === "rejected") { failures.push("Quote unavailable"); continue; }
        const { security, quote } = result.value;
        await database.prepare(`INSERT INTO price_snapshots (id, security_id, price_paise, currency, source, observed_at, retrieved_at, delay_minutes, licensing_status, error_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
          .bind(crypto.randomUUID(), security.id, quote.pricePaise, quote.currency, quote.source, quote.observedAt, quote.retrievedAt, quote.delayMinutes, quote.licensingStatus).run(); savedCount += 1;
      }
      const completedAt = Date.now(); const status = savedCount ? (failures.length ? "partial" : "completed") : "failed"; const freshness = savedCount ? `${savedCount} licensed ${savedCount === 1 ? "quote" : "quotes"} saved at ${new Date(completedAt).toISOString()}` : "No quote was saved";
      await database.prepare("UPDATE sync_runs SET status = ?, completed_at = ?, summary_json = ? WHERE id = ?").bind(status, completedAt, JSON.stringify({ requested: securityRows.results.length, saved: savedCount, failed: failures.length }), syncId).run();
      await database.prepare("UPDATE data_sources SET status = ?, freshness_label = ?, last_success_at = ?, last_error_at = ?, updated_at = ? WHERE id = ?")
        .bind(status, freshness, savedCount ? completedAt : null, failures.length ? completedAt : null, completedAt, dataSourceId).run();
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "market_prices_refreshed", entityType: "portfolio", entityReference: portfolio.id, summary: freshness, metadata: { provider: market.provider, requested: securityRows.results.length, saved: savedCount, failed: failures.length } });
      if (!savedCount && securityRows.results.length) return Response.json({ error: "The licensed provider returned no usable quotes. Existing prices were kept." }, { status: 502 });
    } else if (body.action === "add_watchlist") {
      const securityId = await getOrCreateSecurity(database, body); if (!securityId) return Response.json({ error: "Complete the security details" }, { status: 400 });
      stage = "saving watchlist";
      await commit(database, [
        database.prepare(`INSERT OR IGNORE INTO watchlist_items (id, workspace_id, owner_key, security_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), workspace.id, email, securityId, cleanText(body.note, 300, false) || null, now),
        auditStatement(database, { workspaceId: workspace.id, ownerKey: email, eventType: "watchlist_item_added", entityType: "security", entityReference: securityId, summary: "Security added to watchlist" }),
      ]);
    } else return Response.json({ error: "Unsupported investment action" }, { status: 400 });
    const payload = await portfolioPayload(database, email, workspace.id);
    return Response.json({ ...payload, createdPortfolioId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return investmentError("INVESTMENT_WRITE_FAILED", stage, "ACC could not finish saving this investment record. Nothing was posted twice. Retry using the same operation reference.", 503); }
}
