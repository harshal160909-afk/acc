import { continueTransactionConversation, type PendingTransaction } from "../../lib/ai/transaction-assistant";
import { selectProvider, type AIConversationMessage, type ConversationContextName, type ControlledToolResult } from "../../lib/ai/providers";
import { executeBooksTool } from "../../lib/server/books";
import { getRequestIdentity, unauthenticatedResponse } from "../../lib/server/auth";
import { enforceRateLimit, validateJsonMutation } from "../../lib/server/http-security";
import {
  ensureStore, getDatabase, recordAuditEvent, resolveWorkspace, safeJson,
} from "../../lib/server/context";

const CONTEXTS = new Set<ConversationContextName>(["books", "business", "investments", "market_news"]);

type ThreadRow = {
  id: string; title: string; context: ConversationContextName;
  pending_json: string | null; created_at: number; updated_at: number;
};
type MessageRow = {
  id: string; role: "user" | "assistant"; kind: string; content: string;
  provider: string | null; model: string | null; metadata_json: string | null; created_at: number;
};

function isPlainText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function publicThread(row: ThreadRow) {
  return { id: row.id, title: row.title, context: row.context, createdAt: row.created_at, updatedAt: row.updated_at };
}

function publicMessage(row: MessageRow) {
  return {
    id: row.id, role: row.role, kind: row.kind, content: row.content,
    provider: row.provider, model: row.model, metadata: safeJson(row.metadata_json, {}), createdAt: row.created_at,
  };
}

async function ownedThread(database: Awaited<ReturnType<typeof getDatabase>>, ownerKey: string, threadId: string) {
  const rows = await database.prepare(`
    SELECT id, title, context, pending_json, created_at, updated_at
    FROM ai_threads WHERE id = ? AND owner_key = ? AND archived_at IS NULL LIMIT 1
  `).bind(threadId, ownerKey).all<ThreadRow>();
  return rows.results[0] ?? null;
}

async function saveMessage(
  database: Awaited<ReturnType<typeof getDatabase>>,
  input: {
    threadId: string; workspaceId: string; ownerKey: string;
    role: "user" | "assistant"; kind: string; content: string;
    provider?: string | null; model?: string | null; metadata?: Record<string, unknown>;
  },
) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await database.prepare(`
    INSERT INTO ai_messages (
      id, thread_id, workspace_id, owner_key, role, kind, content,
      provider, model, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, input.threadId, input.workspaceId, input.ownerKey, input.role, input.kind,
    input.content, input.provider ?? null, input.model ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null, now,
  ).run();
  await database.prepare("UPDATE ai_threads SET updated_at = ? WHERE id = ? AND owner_key = ?")
    .bind(now, input.threadId, input.ownerKey).run();
  return { id, createdAt: now };
}

function sseEvent(name: string, value: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
}

function sseResponse(run: (send: (name: string, value: unknown) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (name: string, value: unknown) => controller.enqueue(encoder.encode(sseEvent(name, value)));
      try { await run(send); }
      catch { send("error", { message: "ACC could not complete that response. Your books were not changed." }); }
      finally { controller.close(); }
    },
  }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function selectedBooksTool(question: string) {
  if (/cash flow|cash movement|money moving|breathing room/i.test(question)) return { name: "get_cash_movement", input: {} };
  if (/customer|who owes|receivable/i.test(question)) return { name: "get_customer_balance", input: {} };
  if (/supplier|payable|who.*pay/i.test(question)) return { name: "get_supplier_balance", input: {} };
  if (/transaction|entry|spent on|paid for/i.test(question)) return { name: "search_transactions", input: { query: question.replace(/[^A-Za-z0-9 ₹.-]/g, " ").slice(0, 80) } };
  return { name: "get_financial_summary", input: {} };
}

function selectedContextTool(context: ConversationContextName, question: string) {
  if (context === "investments") return { name: "get_investment_record_summary", input: {} };
  if (context === "market_news") return { name: "get_market_research_summary", input: {} };
  return selectedBooksTool(question);
}

async function executeContextTool(
  database: Awaited<ReturnType<typeof getDatabase>>,
  ownerKey: string,
  workspaceId: string,
  context: ConversationContextName,
  name: string,
  input: Record<string, unknown>,
): Promise<ControlledToolResult> {
  if (context !== "investments" && context !== "market_news") return executeBooksTool(database, ownerKey, name, input);
  const checkedAt = Date.now();
  if (context === "investments") {
    const [portfolios, transactions, holdings, manualPrices] = await Promise.all([
      database.prepare("SELECT COUNT(*) AS count FROM portfolios WHERE owner_key = ? AND workspace_id = ? AND archived_at IS NULL").bind(ownerKey, workspaceId).all<{ count: number }>(),
      database.prepare("SELECT COUNT(*) AS count FROM investment_transactions WHERE owner_key = ? AND workspace_id = ?").bind(ownerKey, workspaceId).all<{ count: number }>(),
      database.prepare(`SELECT COUNT(DISTINCT security_id) AS count FROM investment_transactions
        WHERE owner_key = ? AND workspace_id = ? AND security_id IS NOT NULL`).bind(ownerKey, workspaceId).all<{ count: number }>(),
      database.prepare("SELECT COUNT(DISTINCT security_id) AS count FROM manual_price_snapshots WHERE owner_key = ? AND workspace_id = ?").bind(ownerKey, workspaceId).all<{ count: number }>(),
    ]);
    return {
      name, status: "completed", freshness: `Calculated from owner-scoped investment records at ${new Date(checkedAt).toISOString()}`,
      result: {
        portfolios: portfolios.results[0]?.count ?? 0,
        recordedTransactions: transactions.results[0]?.count ?? 0,
        securitiesWithTransactions: holdings.results[0]?.count ?? 0,
        securitiesWithUserEnteredPrices: manualPrices.results[0]?.count ?? 0,
        limitation: "This summary does not invent live prices, recommendations, or trades.",
      },
    };
  }
  const [profile, sources, opportunities, lastRun] = await Promise.all([
    database.prepare("SELECT industry, target_customer, geography, updated_at FROM market_profiles WHERE owner_key = ? AND workspace_id = ? LIMIT 1").bind(ownerKey, workspaceId).all(),
    database.prepare("SELECT provider, status, enabled, last_success_at, last_error FROM market_sources WHERE owner_key = ? AND workspace_id = ? ORDER BY provider").bind(ownerKey, workspaceId).all(),
    database.prepare("SELECT lifecycle_status, COUNT(*) AS count FROM market_opportunities WHERE owner_key = ? AND workspace_id = ? GROUP BY lifecycle_status").bind(ownerKey, workspaceId).all(),
    database.prepare("SELECT status, stage, completed_at, cleaning_metrics_json FROM market_collection_runs WHERE owner_key = ? AND workspace_id = ? ORDER BY started_at DESC LIMIT 1").bind(ownerKey, workspaceId).all(),
  ]);
  return {
    name, status: "completed", freshness: `Read from ACC Market Research at ${new Date(checkedAt).toISOString()}`,
    result: {
      profile: profile.results[0] ?? null,
      sources: sources.results,
      opportunityCounts: opportunities.results,
      latestCollection: lastRun.results[0] ?? null,
      limitation: "Only configured permitted public sources and recorded evidence are included. This is not a success prediction.",
    },
  };
}

function configurationAnswer(tool: ControlledToolResult) {
  if (tool.name === "get_financial_summary" && tool.status === "completed") {
    return "I calculated the current workspace summary from posted entries. The exact figures are shown in the tool result above. Add an AI provider in Settings to receive a conversational explanation; no ledger action was taken.";
  }
  return "The requested workspace data was checked through ACC’s controlled tools. Add an AI provider in Settings for a conversational explanation; no ledger action was taken.";
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;
  try {
    const database = await getDatabase();
    await ensureStore(database);
    const workspace = await resolveWorkspace(database, email);
    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId")?.trim();
    const threads = await database.prepare(`
      SELECT id, title, context, pending_json, created_at, updated_at
      FROM ai_threads WHERE owner_key = ? AND workspace_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 50
    `).bind(email, workspace.id).all<ThreadRow>();
    let messages: MessageRow[] = [];
    if (threadId) {
      const thread = threads.results.find((row) => row.id === threadId);
      if (!thread) return Response.json({ error: "Conversation was not found" }, { status: 404 });
      const rows = await database.prepare(`
        SELECT id, role, kind, content, provider, model, metadata_json, created_at
        FROM ai_messages WHERE thread_id = ? AND owner_key = ?
        ORDER BY created_at ASC, id ASC LIMIT 300
      `).bind(threadId, email).all<MessageRow>();
      messages = rows.results;
    }
    return Response.json({
      threads: threads.results.map(publicThread),
      messages: messages.map(publicMessage),
      workspace: { name: workspace.name, kind: workspace.kind },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Ask ACC history is unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request);
  if (rejected) return rejected;
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Request body must be valid JSON" }, { status: 400 }); }

  try {
    const database = await getDatabase();
    await ensureStore(database);
    const limited = await enforceRateLimit(database, email, "ask-acc:write", 40, 60_000);
    if (limited) return limited;
    const workspace = await resolveWorkspace(database, email);
    const action = body.action;
    if (action === "create_thread") {
      const context = CONTEXTS.has(body.context as ConversationContextName) ? body.context as ConversationContextName : "books";
      const title = isPlainText(body.title, 80) ? body.title.trim() : "New conversation";
      const id = crypto.randomUUID(); const now = Date.now();
      await database.prepare(`
        INSERT INTO ai_threads (id, workspace_id, owner_key, title, context, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, workspace.id, email, title, context, now, now).run();
      return Response.json({ thread: { id, title, context, createdAt: now, updatedAt: now } }, { status: 201 });
    }
    if (action === "delete_thread") {
      const threadId = isPlainText(body.threadId, 100) ? body.threadId.trim() : "";
      const thread = await ownedThread(database, email, threadId);
      if (!thread) return Response.json({ error: "Conversation was not found" }, { status: 404 });
      await database.prepare("DELETE FROM ai_tool_calls WHERE thread_id = ? AND owner_key = ?").bind(threadId, email).run();
      await database.prepare("DELETE FROM ai_messages WHERE thread_id = ? AND owner_key = ?").bind(threadId, email).run();
      await database.prepare("UPDATE ai_threads SET pending_json = NULL, archived_at = ?, updated_at = ? WHERE id = ? AND owner_key = ?")
        .bind(Date.now(), Date.now(), threadId, email).run();
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "ai_thread_deleted", entityType: "ai_thread", summary: "Conversation deleted by the user" });
      return Response.json({ deleted: true });
    }
    if (action === "cancel_draft") {
      const draftId = isPlainText(body.draftId, 100) ? body.draftId.trim() : "";
      await database.prepare(`
        UPDATE ai_drafts SET status = 'cancelled'
        WHERE id = ? AND owner_key = ? AND workspace_id = ? AND status = 'proposed'
      `).bind(draftId, email, workspace.id).run();
      const cancelled = await database.prepare("SELECT id FROM ai_drafts WHERE id = ? AND owner_key = ? AND workspace_id = ? AND status = 'cancelled' LIMIT 1")
        .bind(draftId, email, workspace.id).all<{ id: string }>();
      if (!cancelled.results[0]) return Response.json({ error: "Draft was not found or is no longer awaiting approval" }, { status: 409 });
      await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "ai_draft_cancelled", entityType: "ai_draft", entityReference: draftId, summary: "AI draft cancelled; books unchanged" });
      return Response.json({ cancelled: true });
    }
    if (action !== "message") return Response.json({ error: "Unsupported action" }, { status: 400 });

    const threadId = isPlainText(body.threadId, 100) ? body.threadId.trim() : "";
    const content = isPlainText(body.content, 2_000) ? body.content.trim() : "";
    if (!threadId || !content) return Response.json({ error: "Conversation and message are required" }, { status: 400 });
    const thread = await ownedThread(database, email, threadId);
    if (!thread) return Response.json({ error: "Conversation was not found" }, { status: 404 });
    const recent = await database.prepare(`
      SELECT COUNT(*) AS message_count FROM ai_messages
      WHERE owner_key = ? AND role = 'user' AND created_at >= ?
    `).bind(email, Date.now() - 60_000).all<{ message_count: number }>();
    if ((recent.results[0]?.message_count ?? 0) >= 20) {
      return Response.json({ error: "Please wait a moment before sending another message" }, { status: 429 });
    }
    await saveMessage(database, { threadId, workspaceId: workspace.id, ownerKey: email, role: "user", kind: "message", content });

    return sseResponse(async (send) => {
      send("meta", { threadId, context: thread.context, freshness: "Workspace data checked at request time" });
      const pending = safeJson<PendingTransaction | null>(thread.pending_json, null);
      const transaction = continueTransactionConversation(content, pending);
      if (transaction.kind === "clarification") {
        await database.prepare("UPDATE ai_threads SET pending_json = ?, updated_at = ? WHERE id = ? AND owner_key = ?")
          .bind(JSON.stringify(transaction.pending), Date.now(), threadId, email).run();
        send("tool", { name: "draft_transaction", status: "needs_information", missingField: transaction.missingField });
        send("delta", { text: transaction.question });
        const saved = await saveMessage(database, {
          threadId, workspaceId: workspace.id, ownerKey: email, role: "assistant", kind: "clarification",
          content: transaction.question, metadata: { missingField: transaction.missingField, source: "deterministic_transaction_flow" },
        });
        send("done", { messageId: saved.id });
        return;
      }
      if (transaction.kind === "proposal") {
        const draftId = crypto.randomUUID();
        const draft = { ...transaction.draft, aiDraftId: draftId };
        await database.prepare(`
          INSERT INTO ai_drafts (id, thread_id, workspace_id, owner_key, payload_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'proposed', ?)
        `).bind(draftId, threadId, workspace.id, email, JSON.stringify(draft), Date.now()).run();
        await database.prepare("UPDATE ai_threads SET pending_json = NULL, updated_at = ? WHERE id = ? AND owner_key = ?")
          .bind(Date.now(), threadId, email).run();
        const explanation = `I have drafted this ${transactionTypeLabelSafe(draft.transactionType)}. Review every detail and approve it before anything enters your books.`;
        send("tool", { name: "validate_journal_entry", status: "completed", balanced: true });
        send("delta", { text: explanation });
        send("proposal", { draft, journalLines: transaction.journalLines, financialEffect: transaction.financialEffect, confidence: transaction.pending.confidence, sources: transaction.sources, inventoryCostStatus: transaction.pending.inventoryCostStatus });
        const saved = await saveMessage(database, {
          threadId, workspaceId: workspace.id, ownerKey: email, role: "assistant", kind: "proposal",
          content: explanation, metadata: {
            draftId, draft, journalLines: transaction.journalLines,
            financialEffect: transaction.financialEffect,
            confidence: transaction.pending.confidence,
            sources: transaction.sources,
            inventoryCostStatus: transaction.pending.inventoryCostStatus,
          },
        });
        await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "ai_transaction_drafted", entityType: "ai_draft", entityReference: draftId, summary: "Transaction draft created; not posted" });
        send("done", { messageId: saved.id });
        return;
      }

      const selected = selectedContextTool(thread.context, content);
      let toolResult: ControlledToolResult;
      try { toolResult = await executeContextTool(database, email, workspace.id, thread.context, selected.name, selected.input); }
      catch { toolResult = { name: selected.name, status: "failed", result: { reason: "Workspace calculation was unavailable" }, freshness: "Unavailable" }; }
      send("tool", toolResult);
      await database.prepare(`
        INSERT INTO ai_tool_calls (
          id, thread_id, workspace_id, owner_key, tool_name,
          input_summary, result_status, duration_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), threadId, workspace.id, email, toolResult.name,
        JSON.stringify({ suppliedFields: Object.keys(selected.input) }), toolResult.status,
        Number(toolResult.result.durationMs ?? 0), Date.now(),
      ).run();
      const historyRows = await database.prepare(`
        SELECT role, content FROM ai_messages WHERE thread_id = ? AND owner_key = ?
        ORDER BY created_at DESC LIMIT 20
      `).bind(threadId, email).all<{ role: "user" | "assistant"; content: string }>();
      const messages: AIConversationMessage[] = historyRows.results.reverse().map((row) => ({ role: row.role, content: row.content }));
      const selection = await selectProvider();
      if (!selection.provider) {
        const answer = configurationAnswer(toolResult);
        send("provider", { status: "configuration_required", health: selection.health });
        send("delta", { text: answer });
        const saved = await saveMessage(database, { threadId, workspaceId: workspace.id, ownerKey: email, role: "assistant", kind: "warning", content: answer, metadata: { providerStatus: "configuration_required", tool: toolResult.name } });
        send("done", { messageId: saved.id });
        return;
      }
      let answer = ""; let providerName = selection.provider.name; let model = selection.provider.model; let emitted = false;
      const streamFrom = async (provider: typeof selection.provider) => {
        if (!provider) return;
        for await (const event of provider.streamConversation({ messages, context: thread.context, toolResults: [toolResult] })) {
          if (event.type === "provider") send("provider", event);
          if (event.type === "delta") { emitted = true; answer += event.text; send("delta", { text: event.text }); }
          if (event.type === "usage") send("usage", event);
        }
      };
      try { await streamFrom(selection.provider); }
      catch {
        if (!emitted && selection.fallback) {
          providerName = selection.fallback.name; model = selection.fallback.model;
          await streamFrom(selection.fallback);
        } else throw new Error("Provider response failed");
      }
      const saved = await saveMessage(database, { threadId, workspaceId: workspace.id, ownerKey: email, role: "assistant", kind: "message", content: answer || "No explanation was returned.", provider: providerName, model, metadata: { tool: toolResult.name, freshness: toolResult.freshness } });
      send("done", { messageId: saved.id });
    });
  } catch {
    return Response.json({ error: "Ask ACC is temporarily unavailable" }, { status: 503 });
  }
}

function transactionTypeLabelSafe(value: unknown) {
  const labels: Record<string, string> = {
    income: "income transaction", expense: "expense", capital_in: "capital entry",
    drawings: "drawings entry", asset_purchase: "asset purchase", liability_borrow: "liability entry",
    liability_repay: "liability repayment", investment_purchase: "business investment",
    bad_debt: "bad-debt write-off", provision_create: "provision", reserve_transfer: "reserve transfer",
  };
  return typeof value === "string" ? labels[value] ?? "transaction" : "transaction";
}
