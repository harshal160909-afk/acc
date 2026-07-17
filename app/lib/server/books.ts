import type { PostedEntry, TransactionCategory, TransactionType, WorkspaceConfig } from "../../components/types";
import { buildCashBridge, calculateAccountBalances, calculateFinancialSummary, financialYearToDateRange } from "../finance";
import type { ControlledToolResult } from "../ai/providers";
import { ensureStore, safeJson, type Database } from "./context";

type ProfileRow = {
  owner_name: string;
  google_email: string;
  workspace_name: string;
  business_type: string | null;
  custom_business_type: string | null;
  legal_structure: string | null;
  financial_year: string;
  opening_bank_paise: number | null;
  cash_in_hand_paise: number | null;
  opening_capital_paise: number | null;
  updated_at: number;
  setup_completed_at: number | null;
};

type EntryRow = {
  id: string;
  date: string;
  description: string | null;
  source: string;
  amount_paise: number | null;
  transaction_type: string | null;
  category: string | null;
  settlement: string;
  debit: string;
  credit: string;
  status: string;
  source_type: string;
  created_by: string | null;
  created_at: number;
  entry_number: string | null;
  idempotency_key: string | null;
  source_file: string | null;
  journal_lines_json: string | null;
  counterparty: string | null;
  reversal_of: string | null;
};

function isSafeNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function loadWorkspaceBooks(database: Database, ownerKey: string) {
  await ensureStore(database);
  const profiles = await database.prepare(`
    SELECT owner_name, google_email, workspace_name, business_type,
      custom_business_type, legal_structure, financial_year,
      opening_bank_paise, cash_in_hand_paise, opening_capital_paise,
      updated_at, setup_completed_at
    FROM business_profiles WHERE owner_key = ? LIMIT 1
  `).bind(ownerKey).all<ProfileRow>();
  const profile = profiles.results[0];
  if (!profile) throw new Error("Complete workspace setup before using Ask ACC");
  const config: WorkspaceConfig = {
    ownerName: profile.owner_name,
    email: profile.google_email,
    businessName: profile.workspace_name,
    businessType: (profile.business_type ?? "other") as WorkspaceConfig["businessType"],
    customBusinessType: profile.custom_business_type ?? "",
    legalStructure: (profile.legal_structure ?? "not_specified") as WorkspaceConfig["legalStructure"],
    openingBankPaise: isSafeNonNegative(profile.opening_bank_paise) ? profile.opening_bank_paise : 0,
    cashInHandPaise: isSafeNonNegative(profile.cash_in_hand_paise) ? profile.cash_in_hand_paise : 0,
    openingCapitalPaise: isSafeNonNegative(profile.opening_capital_paise) ? profile.opening_capital_paise : 0,
    connectionMode: "manual",
    financialYear: profile.financial_year,
    updatedAt: profile.updated_at,
    setupCompletedAt: profile.setup_completed_at ?? profile.updated_at,
  };
  const rows = await database.prepare(`
    SELECT id, date, description, source, amount_paise, transaction_type,
      category, settlement, debit, credit, status, source_type, created_by,
      created_at, entry_number, idempotency_key, source_file,
      journal_lines_json, counterparty, reversal_of
    FROM accounting_entries
    WHERE owner_key = ? AND status = 'posted' AND source_type IN ('manual', 'ai_approved')
    ORDER BY date ASC, created_at ASC, id ASC
  `).bind(ownerKey).all<EntryRow>();
  const entries = rows.results.flatMap((row): PostedEntry[] => {
    if (!isSafeNonNegative(row.amount_paise) || row.amount_paise === 0 || !row.transaction_type || !row.category) return [];
    return [{
      id: row.id,
      idempotencyKey: row.idempotency_key ?? row.id,
      entryNumber: row.entry_number ?? `ACC-${row.id.slice(0, 8).toUpperCase()}`,
      date: row.date,
      description: row.description?.trim() || row.source,
      amountPaise: row.amount_paise,
      transactionType: row.transaction_type as TransactionType,
      category: row.category as TransactionCategory,
      settlement: row.settlement as PostedEntry["settlement"],
      debitAccount: row.debit,
      creditAccount: row.credit,
      status: "posted",
      sourceType: row.source_type === "ai_approved" ? "ai_approved" : "manual",
      createdBy: row.created_by ?? ownerKey,
      createdAt: row.created_at,
      sourceFile: row.source_file,
      journalLines: safeJson(row.journal_lines_json, undefined),
      counterparty: row.counterparty,
      reversalOf: row.reversal_of,
    }];
  });
  return { config, entries };
}

function freshness(entries: readonly PostedEntry[], config: WorkspaceConfig) {
  const latest = Math.max(config.updatedAt ?? 0, ...entries.map((entry) => entry.createdAt));
  return latest ? `Last updated ${new Date(latest).toISOString()}` : "No recorded update time";
}

export async function executeBooksTool(
  database: Database,
  ownerKey: string,
  name: string,
  input: Record<string, unknown> = {},
): Promise<ControlledToolResult> {
  const started = Date.now();
  const { config, entries } = await loadWorkspaceBooks(database, ownerKey);
  const asOf = new Date().toISOString().slice(0, 10);
  const period = financialYearToDateRange(asOf);
  const summary = calculateFinancialSummary(config, entries, period);
  const toolFreshness = freshness(entries, config);
  let result: Record<string, unknown>;
  if (name === "get_financial_summary") {
    result = {
      period,
      cashAtBankPaise: summary.cashAtBank.amountPaise,
      cashInHandPaise: summary.cashInHand.amountPaise,
      availableCashPaise: summary.availableCash.amountPaise,
      revenuePaise: summary.revenue.amountPaise,
      expensesPaise: summary.expenses.amountPaise,
      profitPaise: summary.profit?.amountPaise ?? null,
      receivablesPaise: summary.receivables.amountPaise,
      payablesPaise: summary.payables.amountPaise,
      balanceSheetReady: summary.balanceSheetReady,
      openingBalanceDifferencePaise: summary.balanceSheetDifferencePaise,
      transactionCount: entries.length,
    };
  } else if (name === "get_cash_movement") {
    const bridge = buildCashBridge(config, entries, period);
    result = { ...bridge };
  } else if (name === "search_transactions") {
    const query = typeof input.query === "string" ? input.query.trim().toLowerCase().slice(0, 80) : "";
    result = {
      query,
      matches: entries.filter((entry) => !query || `${entry.description} ${entry.counterparty ?? ""}`.toLowerCase().includes(query))
        .slice(-20).reverse().map((entry) => ({
          entryNumber: entry.entryNumber, date: entry.date, description: entry.description,
          amountPaise: entry.amountPaise, transactionType: entry.transactionType,
          counterparty: entry.counterparty ?? null,
        })),
    };
  } else if (name === "get_account_balance") {
    const account = typeof input.account === "string" ? input.account.trim().slice(0, 120) : "";
    const row = calculateAccountBalances(config, entries).accounts.find((item) => item.account.toLowerCase() === account.toLowerCase());
    result = row ? { account: row.account, balancePaise: row.balancePaise, accountType: row.accountType, lastTransactionDate: row.lastTransactionDate } : { account, unavailable: true };
  } else if (name === "get_customer_balance") {
    const counterparty = typeof input.counterparty === "string" ? input.counterparty.trim().toLowerCase().slice(0, 80) : "";
    const related = entries.filter((entry) => entry.settlement === "receivable" && (!counterparty || entry.counterparty?.toLowerCase().includes(counterparty)));
    const balancePaise = related.reduce((total, entry) => {
      const change = entry.transactionType === "bad_debt" ? -entry.amountPaise : entry.amountPaise;
      const next = total + change;
      if (!Number.isSafeInteger(next)) throw new RangeError("Customer balance exceeded exact paise range");
      return next;
    }, 0);
    result = { counterparty: counterparty || "all customers", balancePaise, records: related.length };
  } else if (name === "get_supplier_balance") {
    const counterparty = typeof input.counterparty === "string" ? input.counterparty.trim().toLowerCase().slice(0, 80) : "";
    const related = entries.filter((entry) => entry.settlement === "payable" && (!counterparty || entry.counterparty?.toLowerCase().includes(counterparty)));
    result = { counterparty: counterparty || "all suppliers", balancePaise: related.reduce((total, entry) => total + entry.amountPaise, 0), records: related.length };
  } else {
    return { name, status: "unavailable", result: { reason: "Tool is not available in this context" }, freshness: toolFreshness };
  }
  return { name, status: "completed", result: { ...result, durationMs: Date.now() - started }, freshness: toolFreshness };
}
