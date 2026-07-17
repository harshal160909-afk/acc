import { ensureStore, resolveWorkspace, safeJson } from "@/app/lib/server/context";
import { getRequestIdentity, unauthenticatedResponse } from "@/app/lib/server/access";
import { getDatabase } from "@/app/lib/server/context";
import { enforceRateLimit, validateJsonMutation } from "@/app/lib/server/http-security";
import type { JournalLine, TransactionDraft } from "@/app/components/types";
import { deriveJournalLines } from "@/app/lib/finance";

type StoredEntry = {
  id: string;
  date: string;
  source: string;
  amount: number;
  debit: string;
  credit: string;
  kind: string;
  settlement: string;
  source_file: string | null;
  created_at: number;
  amount_paise: number | null;
  description: string | null;
  transaction_type: string | null;
  category: string | null;
  status: string;
  source_type: string;
  created_by: string | null;
  entry_number: string | null;
  provenance: string | null;
  idempotency_key: string | null;
  workspace_id: string | null;
  journal_lines_json: string | null;
  counterparty: string | null;
  reversal_of: string | null;
  ai_draft_id: string | null;
};

type TransactionType = TransactionDraft["transactionType"];
type Settlement = "bank" | "cash" | "receivable" | "payable" | "not_applicable";

const CATEGORY_ACCOUNTS = {
  sales_revenue: { transactionTypes: ["income"], account: "Sales Revenue" },
  service_revenue: { transactionTypes: ["income"], account: "Service Revenue" },
  rent_expense: { transactionTypes: ["expense"], account: "Rent Expense" },
  supplies_expense: { transactionTypes: ["expense"], account: "Supplies Expense" },
  payroll_expense: { transactionTypes: ["expense"], account: "Payroll Expense" },
  utilities_expense: { transactionTypes: ["expense"], account: "Utilities Expense" },
  marketing_expense: { transactionTypes: ["expense"], account: "Marketing Expense" },
  other_operating_expense: { transactionTypes: ["expense"], account: "Other Operating Expense" },
  owner_capital: { transactionTypes: ["capital_in"], account: "Owner's Capital" },
  owner_drawings: { transactionTypes: ["drawings"], account: "Drawings" },
  equipment_asset: { transactionTypes: ["asset_purchase"], account: "Equipment" },
  furniture_asset: { transactionTypes: ["asset_purchase"], account: "Furniture" },
  vehicle_asset: { transactionTypes: ["asset_purchase"], account: "Vehicles" },
  property_asset: { transactionTypes: ["asset_purchase"], account: "Property" },
  inventory_asset: { transactionTypes: ["asset_purchase"], account: "Inventory" },
  business_loan: { transactionTypes: ["liability_borrow", "liability_repay"], account: "Business Loan" },
  other_borrowing: { transactionTypes: ["liability_borrow", "liability_repay"], account: "Other Borrowings" },
  investment_asset: { transactionTypes: ["investment_purchase"], account: "Investments" },
  bad_debt_expense: { transactionTypes: ["bad_debt"], account: "Bad Debts Expense" },
  provision_expense: { transactionTypes: ["provision_create"], account: "Provision Expense" },
  general_reserve: { transactionTypes: ["reserve_transfer"], account: "General Reserve" },
  capital_reserve: { transactionTypes: ["reserve_transfer"], account: "Capital Reserve" },
  accounts_receivable: { transactionTypes: ["receivable_collection"], account: "Accounts Receivable" },
  accounts_payable: { transactionTypes: ["supplier_payment"], account: "Accounts Payable" },
  sales_returns: { transactionTypes: ["sales_return"], account: "Sales Returns" },
  purchase_returns: { transactionTypes: ["purchase_return"], account: "Purchase Returns" },
  customer_advances: { transactionTypes: ["customer_advance"], account: "Customer Advances" },
  supplier_advances: { transactionTypes: ["supplier_advance"], account: "Supplier Advances" },
  depreciation_expense: { transactionTypes: ["depreciation"], account: "Depreciation Expense" },
  gst_payable: { transactionTypes: ["tax_payment"], account: "GST Payable" },
  tds_payable: { transactionTypes: ["tax_payment"], account: "TDS Payable" },
  reversal_entry: { transactionTypes: ["reversal"], account: "Suspense" },
} as const;

const TRANSACTION_TYPES = new Set<TransactionType>(["income", "expense", "capital_in", "drawings", "asset_purchase", "liability_borrow", "liability_repay", "investment_purchase", "bad_debt", "provision_create", "reserve_transfer", "receivable_collection", "supplier_payment", "sales_return", "purchase_return", "customer_advance", "supplier_advance", "depreciation", "tax_payment", "reversal"]);
const SETTLEMENTS = new Set<Settlement>(["bank", "cash", "receivable", "payable", "not_applicable"]);

async function prepareStore() {
  const database = await getDatabase();
  await ensureStore(database);
  return database;
}

function isTransactionType(value: unknown): value is TransactionType {
  return typeof value === "string" && TRANSACTION_TYPES.has(value as TransactionType);
}

function isSettlement(value: unknown): value is Settlement {
  return typeof value === "string" && SETTLEMENTS.has(value as Settlement);
}

function isCategory(value: unknown): value is keyof typeof CATEGORY_ACCOUNTS {
  return typeof value === "string" && Object.hasOwn(CATEGORY_ACCOUNTS, value);
}

function deriveAccounts(
  transactionType: TransactionType,
  category: keyof typeof CATEGORY_ACCOUNTS,
  settlement: Settlement,
) {
  const categoryDefinition = CATEGORY_ACCOUNTS[category];
  if (!(categoryDefinition.transactionTypes as readonly string[]).includes(transactionType)) return null;
  const settlementAccount = settlement === "bank" ? "Bank" : settlement === "cash" ? "Cash in Hand" : settlement === "receivable" ? "Accounts Receivable" : settlement === "payable" ? "Accounts Payable" : null;

  if (transactionType === "receivable_collection") return settlementAccount && (settlement === "bank" || settlement === "cash") ? { debitAccount: settlementAccount, creditAccount: "Accounts Receivable" } : null;
  if (transactionType === "supplier_payment") return settlementAccount && (settlement === "bank" || settlement === "cash") ? { debitAccount: "Accounts Payable", creditAccount: settlementAccount } : null;
  if (transactionType === "sales_return") return settlementAccount ? { debitAccount: "Sales Returns", creditAccount: settlementAccount } : null;
  if (transactionType === "purchase_return") return settlementAccount ? { debitAccount: settlementAccount, creditAccount: "Purchase Returns" } : null;
  if (transactionType === "customer_advance") return settlementAccount && (settlement === "bank" || settlement === "cash") ? { debitAccount: settlementAccount, creditAccount: "Customer Advances" } : null;
  if (transactionType === "supplier_advance") return settlementAccount && (settlement === "bank" || settlement === "cash") ? { debitAccount: "Supplier Advances", creditAccount: settlementAccount } : null;
  if (transactionType === "depreciation") return settlement === "not_applicable" ? { debitAccount: "Depreciation Expense", creditAccount: "Accumulated Depreciation" } : null;
  if (transactionType === "tax_payment") return settlementAccount && (settlement === "bank" || settlement === "cash") ? { debitAccount: categoryDefinition.account, creditAccount: settlementAccount } : null;
  if (transactionType === "reversal") return null;

  if (transactionType === "income") {
    const debitAccount = settlement === "bank"
      ? "Bank"
      : settlement === "cash"
        ? "Cash in Hand"
        : settlement === "receivable"
          ? "Accounts Receivable"
          : null;
    if (!debitAccount) return null;
    return { debitAccount, creditAccount: categoryDefinition.account };
  }
  if (transactionType === "capital_in" || transactionType === "liability_borrow") {
    const debitAccount = settlement === "bank" ? "Bank" : settlement === "cash" ? "Cash in Hand" : null;
    return debitAccount ? { debitAccount, creditAccount: categoryDefinition.account } : null;
  }

  if (transactionType === "bad_debt") {
    return settlement === "receivable" ? { debitAccount: categoryDefinition.account, creditAccount: "Accounts Receivable" } : null;
  }
  if (transactionType === "provision_create") {
    return settlement === "not_applicable" ? { debitAccount: categoryDefinition.account, creditAccount: "Provision for Expenses" } : null;
  }
  if (transactionType === "reserve_transfer") {
    return settlement === "not_applicable" ? { debitAccount: "Retained Earnings", creditAccount: categoryDefinition.account } : null;
  }

  const creditAccount = settlement === "bank"
    ? "Bank"
    : settlement === "cash"
      ? "Cash in Hand"
        : settlement === "payable" && (transactionType === "expense" || transactionType === "asset_purchase")
        ? "Accounts Payable"
        : null;
  if (!creditAccount) return null;
  return { debitAccount: categoryDefinition.account, creditAccount };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2200 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function validDescription(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 500 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validPositivePaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(value);
}

function parseProvenance(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseJournalLines(value: string | null) {
  const lines = safeJson<JournalLine[] | null>(value, null);
  if (!lines || !Array.isArray(lines) || lines.length < 2 || lines.length > 12) return null;
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!line || typeof line.account !== "string" || !line.account.trim() || line.account.length > 120) return null;
    if (!Number.isSafeInteger(line.debitPaise) || !Number.isSafeInteger(line.creditPaise)) return null;
    if (line.debitPaise < 0 || line.creditPaise < 0 || (line.debitPaise === 0) === (line.creditPaise === 0)) return null;
    debit += line.debitPaise;
    credit += line.creditPaise;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) return null;
  }
  return debit > 0 && debit === credit ? lines : null;
}

function sameJournalLines(left: JournalLine[], right: JournalLine[]) {
  return left.length === right.length && left.every((line, index) => {
    const expected = right[index];
    return line.account === expected.account && line.debitPaise === expected.debitPaise && line.creditPaise === expected.creditPaise;
  });
}

function publicEntry(row: StoredEntry) {
  const amountPaise = Number.isSafeInteger(row.amount_paise) && (row.amount_paise ?? 0) > 0
    ? row.amount_paise
    : null;
  const transactionType = isTransactionType(row.transaction_type) ? row.transaction_type : null;
  const category = isCategory(row.category) ? row.category : null;
  const settlement = isSettlement(row.settlement) ? row.settlement : null;
  const journalLines = parseJournalLines(row.journal_lines_json);
  const expectedAccounts = transactionType === "reversal" && row.reversal_of && journalLines
    ? { debitAccount: journalLines.find((line) => line.debitPaise > 0)?.account ?? "", creditAccount: journalLines.find((line) => line.creditPaise > 0)?.account ?? "" }
    : transactionType && category && settlement
      ? deriveAccounts(transactionType, category, settlement)
      : null;
  const trustedSource = row.source_type === "manual" || row.source_type === "ai_approved";
  const isVerifiedV2 = row.status === "posted" &&
    trustedSource &&
    amountPaise !== null &&
    expectedAccounts !== null &&
    row.debit === expectedAccounts.debitAccount &&
    row.credit === expectedAccounts.creditAccount &&
    (row.source_type === "manual" || (journalLines !== null && row.ai_draft_id !== null));

  return {
    id: row.id,
    idempotencyKey: row.idempotency_key ?? row.id,
    entryNumber: row.entry_number ?? `LEGACY-${row.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    date: row.date,
    description: row.description?.trim() || row.source,
    amountPaise,
    transactionType,
    category,
    settlement,
    debitAccount: row.debit,
    creditAccount: row.credit,
    status: isVerifiedV2 ? "posted" : "needs_review",
    sourceType: trustedSource ? row.source_type : "legacy",
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
    sourceFile: row.source_file,
    journalLines: journalLines ?? undefined,
    counterparty: row.counterparty,
    reversalOf: row.reversal_of,
    provenance: parseProvenance(row.provenance),
    includedInMetrics: isVerifiedV2,
    needsReview: !isVerifiedV2,
  };
}

function entriesSelect() {
  return `
    SELECT id, date, source, amount, debit, credit, kind, settlement,
      source_file, created_at, amount_paise, description, transaction_type,
      category, status, source_type, created_by, entry_number, provenance,
      idempotency_key, workspace_id, journal_lines_json, counterparty,
      reversal_of, ai_draft_id
    FROM accounting_entries
    WHERE owner_key = ?
    ORDER BY date ASC, created_at ASC, id ASC
  `;
}

function idempotentEntrySelect() {
  return `
    SELECT id, date, source, amount, debit, credit, kind, settlement,
      source_file, created_at, amount_paise, description, transaction_type,
      category, status, source_type, created_by, entry_number, provenance,
      idempotency_key, workspace_id, journal_lines_json, counterparty,
      reversal_of, ai_draft_id
    FROM accounting_entries
    WHERE owner_key = ? AND idempotency_key = ?
    LIMIT 1
  `;
}

async function exactWorkspaceCapacity(
  database: Awaited<ReturnType<typeof prepareStore>>,
  ownerKey: string,
  nextAmountPaise: number,
) {
  const profileTable = await database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'business_profiles' LIMIT 1")
    .all<{ name: string }>();
  if (!profileTable.results.length) {
    return { ok: false as const, message: "Complete workspace setup before posting a record" };
  }

  const profiles = await database.prepare(`
    SELECT opening_bank_paise, cash_in_hand_paise, profile_version
    FROM business_profiles WHERE owner_key = ? LIMIT 1
  `).bind(ownerKey).all<{
    opening_bank_paise: number | null;
    cash_in_hand_paise: number | null;
    profile_version: number;
  }>();
  const profile = profiles.results[0];
  if (
    !profile || profile.profile_version < 3 ||
    !Number.isSafeInteger(profile.opening_bank_paise) || (profile.opening_bank_paise ?? -1) < 0 ||
    !Number.isSafeInteger(profile.cash_in_hand_paise) || (profile.cash_in_hand_paise ?? -1) < 0
  ) {
    return { ok: false as const, message: "Review the workspace opening balances before posting" };
  }

  const totals = await database.prepare(`
    SELECT CAST(COALESCE(SUM(amount_paise), 0) AS TEXT) AS total_paise
    FROM accounting_entries
    WHERE owner_key = ? AND status = 'posted' AND source_type IN ('manual', 'ai_approved')
      AND amount_paise IS NOT NULL AND amount_paise > 0
  `).bind(ownerKey).all<{ total_paise: string }>();
  const openingTotal = BigInt(profile.opening_bank_paise as number) + BigInt(profile.cash_in_hand_paise as number);
  const postedTotal = BigInt(totals.results[0]?.total_paise ?? "0");
  if (openingTotal + postedTotal + BigInt(nextAmountPaise) > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false as const, message: "This record would exceed ACC's exact paise range" };
  }
  return { ok: true as const };
}

function matchesSubmission(
  row: StoredEntry,
  submission: {
    date: string;
    description: string;
    amountPaise: number;
    transactionType: TransactionType;
    category: keyof typeof CATEGORY_ACCOUNTS;
    settlement: Settlement;
  },
  accounts: { debitAccount: string; creditAccount: string },
) {
  return row.date === submission.date &&
    (row.description?.trim() || row.source) === submission.description &&
    row.amount_paise === submission.amountPaise &&
    row.transaction_type === submission.transactionType &&
    row.category === submission.category &&
    row.settlement === submission.settlement &&
    row.debit === accounts.debitAccount &&
    row.credit === accounts.creditAccount;
}

function postedResponse(row: StoredEntry, replayed: boolean) {
  return Response.json(
    { entry: publicEntry(row) },
    {
      status: replayed ? 200 : 201,
      headers: {
        "Cache-Control": "no-store",
        ...(replayed ? { "Idempotency-Replayed": "true" } : {}),
      },
    },
  );
}

async function postReversal(ownerKey: string, actorEmail: string, body: Record<string, unknown>) {
  if (typeof body.entryId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.entryId) || !validDate(body.date)) {
    return Response.json({ error: "Choose a posted entry and a valid reversal date" }, { status: 400 });
  }
  const database = await prepareStore();
  const workspace = await resolveWorkspace(database, ownerKey);
  const rows = await database.prepare(`SELECT id, date, source, amount, debit, credit, kind, settlement, source_file, created_at, amount_paise, description, transaction_type, category, status, source_type, created_by, entry_number, provenance, idempotency_key, workspace_id, journal_lines_json, counterparty, reversal_of, ai_draft_id FROM accounting_entries WHERE id = ? AND owner_key = ? AND workspace_id = ? AND status = 'posted' LIMIT 1`)
    .bind(body.entryId, ownerKey, workspace.id).all<StoredEntry>();
  const original = rows.results[0];
  const originalLines = original ? parseJournalLines(original.journal_lines_json) : null;
  if (!original || !originalLines) return Response.json({ error: "The original posted journal could not be found or verified" }, { status: 404 });
  const existing = await database.prepare("SELECT id FROM accounting_entries WHERE owner_key = ? AND reversal_of = ? AND status = 'posted' LIMIT 1")
    .bind(ownerKey, original.id).all<{ id: string }>();
  if (existing.results[0]) return Response.json({ error: "This entry has already been reversed" }, { status: 409 });
  const locked = await database.prepare("SELECT id FROM period_locks WHERE workspace_id = ? AND owner_key = ? AND unlocked_at IS NULL AND ? BETWEEN start_date AND end_date LIMIT 1")
    .bind(workspace.id, ownerKey, body.date).all<{ id: string }>();
  if (locked.results[0]) return Response.json({ error: "That accounting period is locked. Unlock it before posting a correction." }, { status: 409 });
  const reversed = originalLines.map((line) => ({ account: line.account, debitPaise: line.creditPaise, creditPaise: line.debitPaise }));
  const id = crypto.randomUUID(); const createdAt = Date.now();
  const entryNumber = `ACC-${String(body.date).replaceAll("-", "")}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const debit = reversed.find((line) => line.debitPaise > 0)?.account; const credit = reversed.find((line) => line.creditPaise > 0)?.account;
  if (!debit || !credit || !database.batch) throw new Error("Atomic D1 reversal is unavailable");
  const journalTotal = reversed.reduce((sum, line) => sum + line.debitPaise, 0);
  const insert = database.prepare(`INSERT INTO accounting_entries (id, owner_key, date, source, amount, debit, credit, kind, settlement, source_file, created_at, amount_paise, description, transaction_type, category, status, source_type, created_by, entry_number, provenance, idempotency_key, workspace_id, journal_lines_json, counterparty, reversal_of, ai_draft_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'reversal', 'not_applicable', NULL, ?, ?, ?, 'reversal', 'reversal_entry', 'posted', 'manual', ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`)
    .bind(id, ownerKey, body.date, `Reversal of ${original.entry_number ?? original.id}`, Math.trunc(journalTotal / 100), debit, credit, createdAt, original.amount_paise, `Reversal of ${original.description ?? original.source}`, actorEmail, entryNumber, JSON.stringify({ schemaVersion: 10, classification: "linked_reversal", originalEntryId: original.id, includedInMetrics: true }), body.idempotencyKey, workspace.id, JSON.stringify(reversed), original.id);
  const audit = database.prepare(`INSERT INTO audit_events (id, workspace_id, owner_key, event_type, entity_type, entity_reference, summary, metadata_json, created_at) VALUES (?, ?, ?, 'entry_reversed', 'accounting_entry', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), workspace.id, ownerKey, id, `Reversed ${original.entry_number ?? original.id}`, JSON.stringify({ originalEntryId: original.id, reversalEntryNumber: entryNumber }), createdAt);
  await database.batch([insert, audit]);
  const saved = await database.prepare(idempotentEntrySelect()).bind(ownerKey, body.idempotencyKey).all<StoredEntry>();
  if (!saved.results[0]) throw new Error("Reversal could not be read back");
  return postedResponse(saved.results[0], false);
}

async function postApprovedAiDraft(ownerKey: string, actorEmail: string, body: Record<string, unknown>) {
  if (typeof body.aiDraftId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.aiDraftId)) {
    return Response.json({ error: "A valid ACC draft is required for AI approval" }, { status: 400 });
  }
  const database = await prepareStore();
  await ensureStore(database);
  const workspace = await resolveWorkspace(database, ownerKey);
  const rows = await database.prepare(`
    SELECT id, payload_json, status FROM ai_drafts
    WHERE id = ? AND workspace_id = ? AND owner_key = ? LIMIT 1
  `).bind(body.aiDraftId, workspace.id, ownerKey).all<{ id: string; payload_json: string; status: string }>();
  const stored = rows.results[0];
  if (!stored) return Response.json({ error: "This ACC draft was not found in your workspace" }, { status: 404 });

  if (stored.status === "approved") {
    const replay = await database.prepare(idempotentEntrySelect()).bind(ownerKey, body.idempotencyKey).all<StoredEntry>();
    return replay.results[0]
      ? postedResponse(replay.results[0], true)
      : Response.json({ error: "This draft was already approved" }, { status: 409 });
  }
  if (stored.status !== "proposed") return Response.json({ error: "This ACC draft can no longer be posted" }, { status: 409 });

  const draft = safeJson<TransactionDraft | null>(stored.payload_json, null);
  if (!draft || !validDate(draft.date) || !validDescription(draft.description) ||
      !validPositivePaise(draft.amountPaise) || !isTransactionType(draft.transactionType) ||
      !isCategory(draft.category) || !isSettlement(draft.settlement)) {
    return Response.json({ error: "This ACC draft is incomplete. Please create a new draft." }, { status: 409 });
  }
  const accounts = deriveAccounts(draft.transactionType, draft.category, draft.settlement);
  const journalLines = Array.isArray(draft.journalLines) ? parseJournalLines(JSON.stringify(draft.journalLines)) : null;
  let expectedLines: JournalLine[] | null = null;
  try {
    expectedLines = deriveJournalLines({ ...draft, journalLines: undefined });
    if (draft.inventoryCostStatus === "confirmed" && validPositivePaise(draft.inventoryCostPaise)) {
      expectedLines = [...expectedLines,
        { account: "Cost of Goods Sold", debitPaise: draft.inventoryCostPaise, creditPaise: 0 },
        { account: "Inventory", debitPaise: 0, creditPaise: draft.inventoryCostPaise }];
    }
  } catch { expectedLines = null; }
  if (!accounts || !journalLines || !expectedLines || !sameJournalLines(journalLines, expectedLines) ||
      journalLines.find((line) => line.debitPaise > 0)?.account !== accounts.debitAccount ||
      journalLines.find((line) => line.creditPaise > 0)?.account !== accounts.creditAccount) {
    return Response.json({ error: "ACC could not verify the draft's balanced journal. Please create a new draft." }, { status: 409 });
  }

  const previous = await database.prepare(idempotentEntrySelect()).bind(ownerKey, draft.idempotencyKey).all<StoredEntry>();
  if (previous.results[0]) return postedResponse(previous.results[0], true);
  const capacity = await exactWorkspaceCapacity(database, ownerKey, draft.amountPaise);
  if (!capacity.ok) return Response.json({ error: capacity.message }, { status: 409 });
  const locked = await database.prepare("SELECT id FROM period_locks WHERE workspace_id = ? AND owner_key = ? AND unlocked_at IS NULL AND ? BETWEEN start_date AND end_date LIMIT 1")
    .bind(workspace.id, ownerKey, draft.date).all<{ id: string }>();
  if (locked.results[0]) return Response.json({ error: "That accounting period is locked. Unlock it before posting." }, { status: 409 });

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const entryNumber = `ACC-${draft.date.replaceAll("-", "")}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const provenance = {
    schemaVersion: 10,
    classification: "user_approved_ai_draft",
    amountSource: "user_conversation_paise",
    accountMapping: "deterministic_server_rules",
    approvedBy: actorEmail,
    includedInMetrics: true,
  };
  const journalDebitTotalPaise = journalLines.reduce((sum, line) => sum + line.debitPaise, 0);
  if (!Number.isSafeInteger(journalDebitTotalPaise)) return Response.json({ error: "Journal total is outside ACC's exact range" }, { status: 409 });
  if (!database.batch) throw new Error("Atomic D1 batch is unavailable");
  const insertEntry = database.prepare(`
    INSERT INTO accounting_entries (
      id, owner_key, date, source, amount, debit, credit, kind, settlement,
      source_file, created_at, amount_paise, description, transaction_type,
      category, status, source_type, created_by, entry_number, provenance,
      idempotency_key, workspace_id, journal_lines_json, counterparty,
      reversal_of, ai_draft_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, ownerKey, draft.date, draft.description.trim(), Math.trunc(journalDebitTotalPaise / 100),
    accounts.debitAccount, accounts.creditAccount, draft.transactionType, draft.settlement,
    null, createdAt, draft.amountPaise, draft.description.trim(), draft.transactionType,
    draft.category, "posted", "ai_approved", actorEmail, entryNumber, JSON.stringify(provenance),
    draft.idempotencyKey, workspace.id, JSON.stringify(journalLines), draft.counterparty?.trim() || null,
    null, stored.id,
  );
  const approveDraft = database.prepare("UPDATE ai_drafts SET status = 'approved', approved_at = ? WHERE id = ? AND owner_key = ? AND status = 'proposed'")
    .bind(createdAt, stored.id, ownerKey);
  const auditEvent = database.prepare(`INSERT INTO audit_events (id, workspace_id, owner_key, event_type, entity_type, entity_reference, summary, metadata_json, created_at) VALUES (?, ?, ?, 'ai_draft_approved', 'accounting_entry', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), workspace.id, ownerKey, id, `AI draft approved and posted as ${entryNumber}`, JSON.stringify({ aiDraftId: stored.id, entryNumber }), createdAt);
  await database.batch([approveDraft, insertEntry, auditEvent]);
  const saved = await database.prepare(idempotentEntrySelect()).bind(ownerKey, draft.idempotencyKey).all<StoredEntry>();
  if (!saved.results[0]) throw new Error("Approved entry could not be read back");
  return postedResponse(saved.results[0], false);
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;

  try {
    const database = await prepareStore();
    const result = await database.prepare(entriesSelect()).bind(email).all<StoredEntry>();
    return Response.json(
      { entries: result.results.map(publicEntry) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Accounting records are unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request);
  if (rejected) return rejected;
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const ownerKey = identity.userId;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  try {
    const database = await prepareStore();
    const limited = await enforceRateLimit(database, ownerKey, "entries:post", 30, 60_000);
    if (limited) return limited;
  } catch {
    return Response.json({ error: "Accounting records are unavailable" }, { status: 503 });
  }

  if (!validIdempotencyKey(body.idempotencyKey)) {
    return Response.json({ error: "A valid posting operation key is required" }, { status: 400 });
  }
  if (body.action === "reverse_entry") {
    try { return await postReversal(ownerKey, identity.email, body); }
    catch { return Response.json({ error: "Unable to post the reversal. The original entry was not changed." }, { status: 503 }); }
  }
  if (body.sourceType === "ai_approved") {
    try { return await postApprovedAiDraft(ownerKey, identity.email, body); }
    catch { return Response.json({ error: "Unable to approve and post this ACC draft" }, { status: 503 }); }
  }
  if (!validDate(body.date)) {
    return Response.json({ error: "Transaction date must be a real date in YYYY-MM-DD format" }, { status: 400 });
  }
  if (!validDescription(body.description)) {
    return Response.json({ error: "Describe the transaction in 500 characters or fewer" }, { status: 400 });
  }
  if (!validPositivePaise(body.amountPaise)) {
    return Response.json({ error: "Amount must be a positive whole number of paise" }, { status: 400 });
  }
  if (!isTransactionType(body.transactionType)) {
    return Response.json({ error: "Choose what happened in the business" }, { status: 400 });
  }
  if (!isCategory(body.category)) {
    return Response.json({ error: "Choose a supported transaction category" }, { status: 400 });
  }
  if (!isSettlement(body.settlement)) {
    return Response.json({ error: "Choose where the money was paid, received, or is due" }, { status: 400 });
  }

  const accounts = deriveAccounts(body.transactionType, body.category, body.settlement);
  if (!accounts) {
    return Response.json(
      { error: "The selected category and settlement do not match the transaction type" },
      { status: 400 },
    );
  }

  const submission = {
    idempotencyKey: body.idempotencyKey,
    date: body.date,
    description: body.description.trim(),
    amountPaise: body.amountPaise,
    transactionType: body.transactionType,
    category: body.category,
    settlement: body.settlement,
  };

  try {
    const database = await prepareStore();
    const previous = await database.prepare(idempotentEntrySelect())
      .bind(ownerKey, submission.idempotencyKey)
      .all<StoredEntry>();
    if (previous.results[0]) {
      if (!matchesSubmission(previous.results[0], submission, accounts)) {
        return Response.json(
          { error: "This posting operation key was already used for different transaction details" },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      return postedResponse(previous.results[0], true);
    }

    const capacity = await exactWorkspaceCapacity(database, ownerKey, submission.amountPaise);
    if (!capacity.ok) {
      return Response.json(
        { error: capacity.message },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const id = crypto.randomUUID();
    const entryNumber = `ACC-${submission.date.replaceAll("-", "")}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const createdAt = Date.now();
    const provenance = {
      schemaVersion: 10,
      classification: "user_explicit",
      amountSource: "user_input_paise",
      accountMapping: "server_matrix_v2",
      idempotency: "owner_operation_key",
      includedInMetrics: true,
    };
    const workspace = await resolveWorkspace(database, ownerKey);
    const locked = await database.prepare("SELECT id FROM period_locks WHERE workspace_id = ? AND owner_key = ? AND unlocked_at IS NULL AND ? BETWEEN start_date AND end_date LIMIT 1")
      .bind(workspace.id, ownerKey, submission.date).all<{ id: string }>();
    if (locked.results[0]) return Response.json({ error: "That accounting period is locked. Unlock it before posting." }, { status: 409 });
    const journalLines = deriveJournalLines({ ...submission, sourceType: "manual" });
    const journalDebitTotalPaise = journalLines.reduce((sum, line) => sum + line.debitPaise, 0);
    if (!Number.isSafeInteger(journalDebitTotalPaise) || !database.batch) throw new Error("Atomic D1 posting is unavailable");
    try {
      const insertEntry = database.prepare(`
        INSERT INTO accounting_entries (
          id, owner_key, date, source, amount, debit, credit, kind,
          settlement, source_file, created_at, amount_paise, description,
          transaction_type, category, status, source_type, created_by,
          entry_number, provenance, idempotency_key, workspace_id, journal_lines_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        ownerKey,
        submission.date,
        submission.description,
        Math.trunc(journalDebitTotalPaise / 100),
        accounts.debitAccount,
        accounts.creditAccount,
        submission.transactionType,
        submission.settlement,
        null,
        createdAt,
        submission.amountPaise,
        submission.description,
        submission.transactionType,
        submission.category,
        "posted",
        "manual",
        identity.email,
        entryNumber,
        JSON.stringify(provenance),
        submission.idempotencyKey,
        workspace.id,
        JSON.stringify(journalLines),
      );
      const auditEvent = database.prepare(`INSERT INTO audit_events (id, workspace_id, owner_key, event_type, entity_type, entity_reference, summary, metadata_json, created_at) VALUES (?, ?, ?, 'manual_entry_posted', 'accounting_entry', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workspace.id, ownerKey, id, `Manual entry posted as ${entryNumber}`, JSON.stringify({ entryNumber }), createdAt);
      await database.batch([insertEntry, auditEvent]);
    } catch (error) {
      const replay = await database.prepare(idempotentEntrySelect())
        .bind(ownerKey, submission.idempotencyKey)
        .all<StoredEntry>();
      if (replay.results[0] && matchesSubmission(replay.results[0], submission, accounts)) {
        return postedResponse(replay.results[0], true);
      }
      throw error;
    }

    const saved = await database.prepare(idempotentEntrySelect())
      .bind(ownerKey, submission.idempotencyKey)
      .all<StoredEntry>();
    if (!saved.results[0]) throw new Error("Posted entry could not be read back");
    return postedResponse(saved.results[0], false);
  } catch {
    return Response.json(
      { error: "Unable to post the accounting record" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
