import { clearSessionCookie, getRequestIdentity, sha256, unauthenticatedResponse } from "@/app/lib/server/access";
import { ensureStore, getDatabase, type Database } from "@/app/lib/server/context";
import { enforceRateLimit, validateJsonMutation } from "@/app/lib/server/http-security";

const OWNER_TABLES = [
  "accounting_entries", "business_profiles", "workspace_memberships", "ai_threads", "ai_messages", "ai_tool_calls",
  "ai_feedback", "ai_drafts", "audit_events", "portfolios", "watchlist_items", "investment_transactions",
  "manual_price_snapshots", "data_sources", "support_requests", "market_profiles", "market_sources",
  "market_collection_runs", "market_signals", "market_problem_clusters", "market_opportunities",
  "market_opportunity_events", "market_experiments", "market_competitor_insights", "market_alerts",
  "period_locks", "bank_statement_imports", "bank_statement_lines", "inventory_items", "fixed_assets",
] as const;

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  try {
    const database = await getDatabase(); await ensureStore(database);
    const data: Record<string, unknown[]> = {};
    for (const table of OWNER_TABLES) data[table] = (await database.prepare(`SELECT * FROM ${table} WHERE owner_key = ?`).bind(identity.userId).all()).results;
    data.workspaces = (await database.prepare("SELECT * FROM workspaces WHERE owner_key = ?").bind(identity.userId).all()).results;
    const workspaceIds = data.workspaces.map((row) => String((row as Record<string, unknown>).id));
    data.user = [{ id: identity.userId, email: identity.email, displayName: identity.displayName }];
    return Response.json({
      format: "ACC user export", schemaVersion: 10, exportedAt: new Date().toISOString(),
      scope: "All owner-scoped records available to ACC", workspaceIds, data,
    }, { headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="acc-data-${new Date().toISOString().slice(0, 10)}.json"` } });
  } catch { return Response.json({ error: "ACC could not prepare your complete data export" }, { status: 503 }); }
}

export async function DELETE(request: Request) {
  const rejected = validateJsonMutation(request, 8_000); if (rejected) return rejected;
  const identity = await getRequestIdentity(request); if (!identity) return unauthenticatedResponse();
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  if (body.confirmation !== "DELETE ACC DATA") return Response.json({ error: "Type DELETE ACC DATA to confirm permanent deletion" }, { status: 400 });
  try {
    const database = await getDatabase(); await ensureStore(database);
    const limited = await enforceRateLimit(database, identity.userId, "account:delete", 2, 86_400_000); if (limited) return limited;
    if (!database.batch) throw new Error("Atomic D1 deletion is unavailable");
    const statements = await deletionStatements(database, identity.userId);
    await database.batch(statements);
    return Response.json({ deleted: true, message: "Your ACC account and owner-scoped records were permanently deleted." }, { headers: { "Cache-Control": "no-store", "Set-Cookie": clearSessionCookie() } });
  } catch { return Response.json({ error: "Account deletion did not complete. No partial deletion was accepted." }, { status: 503 }); }
}

async function deletionStatements(database: Database, userId: string) {
  const workspaceScopedWithoutOwner = ["market_cleaning_runs", "sync_runs", "news_items"];
  const statements = workspaceScopedWithoutOwner.map((table) => database.prepare(`DELETE FROM ${table} WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_key = ?)` ).bind(userId));
  statements.push(
    database.prepare("DELETE FROM portfolio_accounts WHERE portfolio_id IN (SELECT id FROM portfolios WHERE owner_key = ?)").bind(userId),
    database.prepare("DELETE FROM holding_lots WHERE portfolio_id IN (SELECT id FROM portfolios WHERE owner_key = ?)").bind(userId),
  );
  for (const table of OWNER_TABLES) statements.push(database.prepare(`DELETE FROM ${table} WHERE owner_key = ?`).bind(userId));
  statements.push(
    database.prepare("DELETE FROM rate_limit_events WHERE owner_key = ?").bind(userId),
    database.prepare("DELETE FROM workspaces WHERE owner_key = ?").bind(userId),
    database.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId),
    database.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    database.prepare("INSERT INTO privacy_receipts (id, user_id_hash, action, created_at) VALUES (?, ?, 'account_deleted', ?)")
      .bind(crypto.randomUUID(), await sha256(userId), Date.now()),
  );
  return statements;
}
