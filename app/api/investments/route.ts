import { getRequestIdentity, unauthenticatedResponse } from "@/app/lib/server/auth";
import { ensureStore, getDatabase, recordAuditEvent, resolveWorkspace } from "@/app/lib/server/context";
import { investmentCashEffect, multiplyPriceByQuantity, parseQuantityMicros, type InvestmentTransactionType } from "@/app/lib/investments";
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
  const existing = await database.prepare("SELECT id FROM securities WHERE symbol = ? AND exchange = ? LIMIT 1")
    .bind(symbol, exchange).all<{ id: string }>();
  if (existing.results[0]) return existing.results[0].id;
  const id = crypto.randomUUID();
  const now = Date.now();
  await database.prepare(`INSERT INTO securities (id, symbol, exchange, name, asset_class, sector, currency, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'INR', 'manual', ?, ?)`)
    .bind(id, symbol, exchange, name, assetClass, cleanText(input.sector, 80, false) || null, now, now).run();
  return id;
}

async function portfolioPayload(database: Awaited<ReturnType<typeof getDatabase>>, email: string, workspaceId: string) {
  const [portfoliosResult, transactionsResult, securitiesResult, pricesResult, manualPricesResult, watchlistResult, marketConfig] = await Promise.all([
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
    database.prepare(`SELECT p.security_id, p.price_paise, p.source, p.observed_at, p.retrieved_at, p.delay_minutes, p.licensing_status
      FROM price_snapshots p INNER JOIN (
        SELECT security_id, MAX(observed_at) observed_at FROM price_snapshots GROUP BY security_id
      ) latest ON latest.security_id = p.security_id AND latest.observed_at = p.observed_at
      WHERE p.source <> 'user_manual' AND p.licensing_status <> 'user_supplied'`).all<PriceRow>(),
    database.prepare(`SELECT m.security_id, m.price_paise, 'user_manual' AS source,
      m.observed_at, m.observed_at AS retrieved_at, 0 AS delay_minutes, 'user_supplied' AS licensing_status
      FROM manual_price_snapshots m INNER JOIN (
        SELECT security_id, MAX(observed_at) observed_at FROM manual_price_snapshots
        WHERE owner_key = ? AND workspace_id = ? GROUP BY security_id
      ) latest ON latest.security_id = m.security_id AND latest.observed_at = m.observed_at
      WHERE m.owner_key = ? AND m.workspace_id = ?`).bind(email, workspaceId, email, workspaceId).all<PriceRow>(),
    database.prepare(`SELECT w.id, w.security_id, w.note, w.created_at, s.symbol, s.exchange, s.name
      FROM watchlist_items w JOIN securities s ON s.id = w.security_id
      WHERE w.owner_key = ? AND w.workspace_id = ? ORDER BY w.created_at DESC`).bind(email, workspaceId).all(),
    readMarketConfig(),
  ]);
  const latestPrice = new Map(pricesResult.results.map((row) => [row.security_id, row]));
  for (const row of manualPricesResult.results) {
    const shared = latestPrice.get(row.security_id);
    if (!shared || row.observed_at >= shared.observed_at) latestPrice.set(row.security_id, row);
  }
  const portfolioSummaries = portfoliosResult.results.map((portfolio) => {
    const rows = transactionsResult.results.filter((row) => row.portfolio_id === portfolio.id);
    const positions = new Map<string, { securityId: string; symbol: string; exchange: string; name: string; assetClass: string; quantityMicros: number; investedPaise: number }>();
    let cashPaise = 0;
    for (const row of rows) {
      cashPaise += investmentCashEffect(row.transaction_type, row.amount_paise, row.fees_paise, row.taxes_paise);
      if (!row.security_id) continue;
      const holding = positions.get(row.security_id) ?? { securityId: row.security_id, symbol: row.symbol ?? "—", exchange: row.exchange ?? "—", name: row.security_name ?? "Unnamed security", assetClass: row.asset_class ?? "other", quantityMicros: 0, investedPaise: 0 };
      if (row.transaction_type === "buy") { holding.quantityMicros += row.quantity_micros ?? 0; holding.investedPaise += row.amount_paise + row.fees_paise + row.taxes_paise; }
      if (row.transaction_type === "sell") { holding.quantityMicros -= row.quantity_micros ?? 0; holding.investedPaise -= row.amount_paise - row.fees_paise - row.taxes_paise; }
      positions.set(row.security_id, holding);
    }
    const holdings = [...positions.values()].filter((holding) => holding.quantityMicros !== 0).map((holding) => {
      const price = latestPrice.get(holding.securityId);
      const currentValuePaise = price ? multiplyPriceByQuantity(price.price_paise, holding.quantityMicros) : null;
      return { ...holding, currentValuePaise, price: price ? { pricePaise: price.price_paise, source: price.source, observedAt: price.observed_at, retrievedAt: price.retrieved_at, delayMinutes: price.delay_minutes, licensingStatus: price.licensing_status } : null };
    });
    const completeValue = holdings.every((holding) => holding.currentValuePaise !== null);
    const holdingsValuePaise = holdings.reduce((sum, holding) => sum + (holding.currentValuePaise ?? 0), 0);
    return { ...portfolio, isPaper: Boolean(portfolio.is_paper), guardianManaged: Boolean(portfolio.guardian_managed), cashPaise, holdingsValuePaise, totalValuePaise: completeValue ? cashPaise + holdingsValuePaise : null, valuationStatus: completeValue ? "complete" : holdings.length ? "missing_prices" : "cash_only", holdings, transactions: rows.slice().reverse() };
  });
  return { portfolios: portfolioSummaries, securities: securitiesResult.results, watchlist: watchlistResult.results, marketConfigured: marketConfig.configured, marketProvider: marketConfig.configured ? marketConfig.provider : null, dataStatus: marketConfig.configured ? "licensed_source_configured" : manualPricesResult.results.length ? "manual_prices_available" : "no_market_source_configured", freshness: { calculatedAt: Date.now(), pricePolicy: "Only your workspace's manual prices or shared licensed-provider prices are used. Missing prices remain unavailable." } };
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;
  try {
    const database = await getDatabase(); await ensureStore(database); const workspace = await resolveWorkspace(database, email);
    return Response.json(await portfolioPayload(database, email, workspace.id), { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Investment records are unavailable" }, { status: 503 }); }
}

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request);
  if (rejected) return rejected;
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  try {
    const database = await getDatabase(); await ensureStore(database);
    const limited = await enforceRateLimit(database, email, "investments:write", 30, 60_000); if (limited) return limited;
    const workspace = await resolveWorkspace(database, email); const now = Date.now();
    let createdPortfolioId: string | null = null;
    if (body.action === "create_portfolio") {
      const name = cleanText(body.name, 80); if (!name) return Response.json({ error: "Give the portfolio a clear name" }, { status: 400 });
      const id = crypto.randomUUID();
      await database.prepare(`INSERT INTO portfolios (id, workspace_id, owner_key, name, portfolio_type, currency, is_paper, guardian_managed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?)`)
        .bind(id, workspace.id, email, name, cleanText(body.portfolioType, 30, false) || "personal", body.isPaper === true ? 1 : 0, body.guardianManaged === true ? 1 : 0, now, now).run();
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "portfolio_created", entityType: "portfolio", entityReference: id, summary: `Portfolio created: ${name}` });
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
      await database.prepare(`INSERT INTO investment_transactions (id, portfolio_id, workspace_id, owner_key, security_id, transaction_type, trade_date, quantity_micros, price_paise, amount_paise, fees_paise, taxes_paise, note, provenance_json, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, portfolio.id, workspace.id, email, securityId, transactionType, body.tradeDate, quantityMicros, pricePaise, amountPaise, feesPaise, taxesPaise, cleanText(body.note, 300, false) || null, JSON.stringify({ schemaVersion: 10, source: "user_manual", recordedByUserId: identity.userId }), body.idempotencyKey, now).run();
      await database.prepare("UPDATE portfolios SET updated_at = ? WHERE id = ?").bind(now, portfolio.id).run();
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "investment_transaction_recorded", entityType: "investment_transaction", entityReference: id, summary: `Manual ${transactionType} recorded`, metadata: { portfolioId: portfolio.id, amountPaise } });
    } else if (body.action === "set_manual_price") {
      if (!validId(body.securityId) || paise(body.pricePaise) === null) return Response.json({ error: "Choose a security and enter a positive exact price" }, { status: 400 });
      const allowed = await database.prepare(`SELECT s.id FROM securities s LEFT JOIN investment_transactions t ON t.security_id = s.id LEFT JOIN watchlist_items w ON w.security_id = s.id WHERE s.id = ? AND ((t.owner_key = ? AND t.workspace_id = ?) OR (w.owner_key = ? AND w.workspace_id = ?)) LIMIT 1`).bind(body.securityId, email, workspace.id, email, workspace.id).all<{ id: string }>();
      if (!allowed.results[0]) return Response.json({ error: "Security not found in your workspace" }, { status: 404 });
      const observedAt = typeof body.observedAt === "number" && Number.isSafeInteger(body.observedAt) && body.observedAt <= now ? body.observedAt : now;
      await database.prepare(`INSERT INTO manual_price_snapshots (id, security_id, workspace_id, owner_key, price_paise, currency, observed_at, created_at) VALUES (?, ?, ?, ?, ?, 'INR', ?, ?)`)
        .bind(crypto.randomUUID(), body.securityId, workspace.id, email, body.pricePaise, observedAt, now).run();
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "manual_price_recorded", entityType: "security", entityReference: body.securityId, summary: "User-entered security price recorded", metadata: { pricePaise: body.pricePaise, observedAt } });
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
      await database.prepare(`INSERT OR IGNORE INTO watchlist_items (id, workspace_id, owner_key, security_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workspace.id, email, securityId, cleanText(body.note, 300, false) || null, now).run();
    } else return Response.json({ error: "Unsupported investment action" }, { status: 400 });
    return Response.json({ ...(await portfolioPayload(database, email, workspace.id)), createdPortfolioId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Unable to save the investment record" }, { status: 503 }); }
}
