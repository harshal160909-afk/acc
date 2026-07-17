import type { JournalLine, SettlementAccount, TransactionCategory, TransactionDraft, TransactionType } from "../../components/types";
import { deriveJournalLines, transactionTypeLabel } from "../finance";

export type PendingTransaction = {
  originalText: string;
  description: string | null;
  transactionType: TransactionType | null;
  amountPaise: number | null;
  date: string;
  dateSource: "user" | "relative_date" | "system_default_today";
  category: TransactionCategory | null;
  settlement: SettlementAccount | null;
  settlementBreakdown: TransactionDraft["settlementBreakdown"];
  counterparty: string | null;
  inventoryRelevant: boolean;
  inventoryCostPaise: number | null;
  inventoryCostStatus: "not_applicable" | "missing" | "pending" | "confirmed";
  netAmountPaise: number | null;
  taxPaise: number | null;
  taxRateBps: number | null;
  taxAccount: "Output GST" | "Input GST" | null;
  quantity: number | null;
  unitPricePaise: number | null;
  confidence: number | null;
};

export type TransactionConversationResult =
  | { kind: "not_transaction" }
  | { kind: "clarification"; pending: PendingTransaction; question: string; missingField: string }
  | { kind: "proposal"; pending: PendingTransaction; draft: TransactionDraft; journalLines: JournalLine[]; financialEffect: string; sources: string[] };

const transactionSignals = /\b(sold|sale|received|earned|provided|invoiced|paid|spent|bought|purchased|capital|invested|withdrew|drawing|borrowed|loan|repaid|bad debt|provision|reserve|return|returned|refund|refunded|advance|depreciation|gst|tds|reverse)\b|बेचा|खरीदा|भुगतान|पूंजी|ऋण/i;
const units = "lakh|lakhs|lac|lacs|crore|crores|thousand|thousands|k";
const moneyPattern = new RegExp(`(?:₹|rs\\.?|inr)?\\s*((?:\\d{1,2}(?:,\\d{2})*,\\d{3}|\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)\\s*(${units})?`, "gi");

function todayISO(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function decimalRupeesToPaise(raw: string, unit?: string | null) {
  const normalized = raw.replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  let paise = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  const label = unit?.toLowerCase();
  const multiplier = label?.startsWith("crore") ? BigInt(10_000_000) : label?.startsWith("l") ? BigInt(100_000) : label?.startsWith("thousand") || label === "k" ? BigInt(1_000) : BigInt(1);
  paise *= multiplier;
  return paise > BigInt(0) && paise <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(paise) : null;
}

export function parseIndianAmountPaise(text: string) {
  const values: number[] = [];
  moneyPattern.lastIndex = 0;
  for (const match of text.matchAll(moneyPattern)) {
    const full = match[0];
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 18), start).toLowerCase();
    const after = text.slice(start + full.length, start + full.length + 10).toLowerCase();
    const explicitlyMoney = /₹|rs\.?|inr/i.test(full) || Boolean(match[2]) || /worth|amount|paid|received|for|of|price|cost|sale|capital|loan/.test(before);
    if (after.trimStart().startsWith("%") || (!explicitlyMoney && Number(match[1].replaceAll(",", "")) < 100)) continue;
    const value = decimalRupeesToPaise(match[1], match[2]);
    if (value !== null) values.push(value);
  }
  return values;
}

function quantityPrice(text: string) {
  const match = /\b(\d+(?:\.\d{1,6})?)\s*(?:items?|units?|shirts?|pieces?|pcs?|bottles?|boxes?)?\s*(?:at|x|×|\*)\s*(?:₹|rs\.?|inr)?\s*((?:\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(lakh|lakhs|lac|lacs|crore|crores|thousand|thousands|k)?\b/i.exec(text);
  if (!match) return null;
  const quantity = Number(match[1]);
  const unitPricePaise = decimalRupeesToPaise(match[2], match[3]);
  if (!Number.isFinite(quantity) || quantity <= 0 || !unitPricePaise) return null;
  const total = BigInt(Math.round(quantity * 1_000_000)) * BigInt(unitPricePaise) / BigInt(1_000_000);
  if (total <= BigInt(0) || total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { quantity, unitPricePaise, totalPaise: Number(total) };
}

function amountDetails(text: string, type: TransactionType | null) {
  const quantity = quantityPrice(text);
  const amounts = parseIndianAmountPaise(text);
  const base = quantity?.totalPaise ?? (amounts.length ? Math.max(...amounts) : null);
  if (!base) return { amountPaise: null, netAmountPaise: null, taxPaise: null, taxRateBps: null, taxAccount: null, quantity: quantity?.quantity ?? null, unitPricePaise: quantity?.unitPricePaise ?? null };
  const gst = /(?:plus|\+)\s*(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:gst|tax)|(?:gst|tax)\s*(?:at|@)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/i.exec(text);
  const rate = Number(gst?.[1] ?? gst?.[2] ?? 0);
  if (rate > 0 && rate <= 50) {
    const rateBps = Math.round(rate * 100);
    const tax = Number((BigInt(base) * BigInt(rateBps) + BigInt(5_000)) / BigInt(10_000));
    const gross = base + tax;
    return { amountPaise: gross, netAmountPaise: base, taxPaise: tax, taxRateBps: rateBps, taxAccount: type === "income" ? "Output GST" as const : "Input GST" as const, quantity: quantity?.quantity ?? null, unitPricePaise: quantity?.unitPricePaise ?? null };
  }
  return { amountPaise: base, netAmountPaise: null, taxPaise: null, taxRateBps: null, taxAccount: null, quantity: quantity?.quantity ?? null, unitPricePaise: quantity?.unitPricePaise ?? null };
}

function explicitDate(text: string) {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text)?.[1];
  if (iso) return { date: iso, source: "user" as const };
  if (/\byesterday\b|कल/i.test(text)) return { date: todayISO(-1), source: "relative_date" as const };
  if (/\btoday\b|आज/i.test(text)) return { date: todayISO(), source: "relative_date" as const };
  return null;
}

function transactionTypeFrom(text: string): TransactionType | null {
  if (/\breverse|reversal|duplicate entry|undo entry/i.test(text)) return "reversal";
  if (/customer.*return|sales? return|credit note|refund(?:ed)? customer/i.test(text)) return "sales_return";
  if (/returned.*(?:supplier|vendor)|purchase return|debit note/i.test(text)) return "purchase_return";
  if (/received.*(?:against|towards).*(?:previous|credit sale|receivable|amount due)|collected.*(?:receivable|customer)|customer.*paid.*previous/i.test(text)) return "receivable_collection";
  if (/paid.*(?:supplier|vendor).*(?:against|towards|amount due|payable)|settled.*(?:supplier|payable)/i.test(text)) return "supplier_payment";
  if (/advance.*(?:received|from customer)|customer advance/i.test(text)) return "customer_advance";
  if (/advance.*(?:paid|to supplier)|supplier advance/i.test(text)) return "supplier_advance";
  if (/depreciation/i.test(text)) return "depreciation";
  if (/paid.*\b(?:gst|tds)\b|\b(?:gst|tds) payment\b/i.test(text)) return "tax_payment";
  if (/bad debt|unrecoverable|write.?off|डूबत/i.test(text)) return "bad_debt";
  if (/provision|प्रावधान/i.test(text)) return "provision_create";
  if (/reserve|रिजर्व/i.test(text)) return "reserve_transfer";
  if (/repay|repaid|loan payment|ऋण.*भुगतान/i.test(text)) return "liability_repay";
  if (/borrow|loan received|ऋण लिया/i.test(text)) return "liability_borrow";
  if (/capital|owner (?:put|introduced|invested)|पूंजी/i.test(text)) return "capital_in";
  if (/drawing|withdrew|withdrawn|personal use|निकाल/i.test(text)) return "drawings";
  if (/fixed deposit|mutual fund|business investment|invested in/i.test(text)) return "investment_purchase";
  if (/machine|machinery|equipment|laptop|computer|furniture|vehicle|car|property|land|inventory|stock purchased/i.test(text) && /buy|bought|purchase|paid|खरीद/i.test(text)) return "asset_purchase";
  if (/sold|sale|earned|customer paid|client paid|provided.*service|service (?:provided|rendered)|invoice issued|invoiced|बेचा|कमाया/i.test(text)) return "income";
  if (/paid|spent|expense|bill|rent|salary|wages|supplies|electricity|marketing|भुगतान|खर्च/i.test(text)) return "expense";
  return null;
}

function categoryFrom(text: string, type: TransactionType | null): TransactionCategory | null {
  if (!type) return null;
  if (type === "receivable_collection") return "accounts_receivable";
  if (type === "supplier_payment") return "accounts_payable";
  if (type === "sales_return") return "sales_returns";
  if (type === "purchase_return") return "purchase_returns";
  if (type === "customer_advance") return "customer_advances";
  if (type === "supplier_advance") return "supplier_advances";
  if (type === "depreciation") return "depreciation_expense";
  if (type === "tax_payment") return /tds/i.test(text) ? "tds_payable" : "gst_payable";
  if (type === "reversal") return "reversal_entry";
  if (type === "income") return /service|consult|fee|website|design|professional/i.test(text) ? "service_revenue" : /sold|sale|goods|clothes|product|inventory|shirts?/i.test(text) ? "sales_revenue" : null;
  if (type === "expense") {
    if (/rent/i.test(text)) return "rent_expense";
    if (/salary|wages|payroll/i.test(text)) return "payroll_expense";
    if (/electricity|utility|utilities|internet/i.test(text)) return "utilities_expense";
    if (/marketing|advertis/i.test(text)) return "marketing_expense";
    if (/suppl|stationery/i.test(text)) return "supplies_expense";
    return "other_operating_expense";
  }
  if (type === "capital_in") return "owner_capital";
  if (type === "drawings") return "owner_drawings";
  if (type === "liability_borrow" || type === "liability_repay") return /bank loan/i.test(text) ? "business_loan" : "other_borrowing";
  if (type === "investment_purchase") return "investment_asset";
  if (type === "bad_debt") return "bad_debt_expense";
  if (type === "provision_create") return "provision_expense";
  if (type === "reserve_transfer") return /capital reserve/i.test(text) ? "capital_reserve" : "general_reserve";
  if (type === "asset_purchase") {
    if (/furniture/i.test(text)) return "furniture_asset";
    if (/vehicle|car/i.test(text)) return "vehicle_asset";
    if (/property|land|building/i.test(text)) return "property_asset";
    if (/inventory|stock/i.test(text)) return "inventory_asset";
    return "equipment_asset";
  }
  return null;
}

function settlementFrom(text: string, type: TransactionType | null): SettlementAccount | null {
  if (type === "bad_debt") return "receivable";
  if (type === "provision_create" || type === "reserve_transfer" || type === "depreciation" || type === "reversal") return "not_applicable";
  if (/cheque|check|bank|upi|neft|rtgs|imps|transfer|card/i.test(text)) return "bank";
  if (/\bcash\b/i.test(text)) return "cash";
  if (/on credit|pay later|will pay|credit sale|still owe|receivable/i.test(text)) return type === "expense" || type === "asset_purchase" || type === "purchase_return" ? "payable" : "receivable";
  if (/owe supplier|pay supplier later|credit purchase|payable/i.test(text)) return "payable";
  return null;
}

function settlementBreakdown(text: string, totalPaise: number | null): TransactionDraft["settlementBreakdown"] {
  if (!totalPaise || !/rest.*(?:credit|due|payable)|(?:cash|bank).*(?:and|plus).*rest/i.test(text)) return undefined;
  const amounts = parseIndianAmountPaise(text).filter((value) => value < totalPaise);
  const paid = amounts.length ? Math.max(...amounts) : null;
  if (!paid || paid >= totalPaise) return undefined;
  const paidSettlement: SettlementAccount = /bank|upi|cheque|card|neft|rtgs|imps/i.test(text) ? "bank" : "cash";
  return [{ settlement: paidSettlement, amountPaise: paid }, { settlement: "payable", amountPaise: totalPaise - paid }];
}

function counterpartyFrom(text: string) {
  const match = /\b(?:to|from|customer|client|supplier|vendor)\s+([A-Za-z][A-Za-z .'-]{1,60}?)(?=\s+(?:for|worth|against|towards|by|in|on|₹|rs\.?|inr|and)\b|[.,]|$)/i.exec(text);
  return match?.[1]?.trim() || null;
}

function inventoryRelevant(text: string, type: TransactionType | null, category: TransactionCategory | null) {
  return type === "income" && category === "sales_revenue" && /clothes|goods|product|inventory|stock|item|shirts?/i.test(text);
}

function mergeClarification(pending: PendingTransaction, answer: string): PendingTransaction {
  const type = pending.transactionType ?? transactionTypeFrom(answer);
  const amount = amountDetails(answer, type);
  const next = { ...pending };
  if (next.amountPaise === null && amount.amountPaise !== null) Object.assign(next, amount);
  if (!next.transactionType) next.transactionType = type;
  if (!next.category) next.category = categoryFrom(answer, next.transactionType);
  if (!next.settlement) next.settlement = settlementFrom(answer, next.transactionType);
  if (!next.counterparty) next.counterparty = counterpartyFrom(answer);
  const date = explicitDate(answer); if (date) { next.date = date.date; next.dateSource = date.source; }
  if (next.inventoryCostStatus === "missing") {
    if (/don'?t know|unknown|not available|cost pending|later/i.test(answer)) next.inventoryCostStatus = "pending";
    else if (amount.amountPaise !== null) { next.inventoryCostPaise = amount.amountPaise; next.inventoryCostStatus = "confirmed"; }
  }
  return next;
}

function nextClarification(pending: PendingTransaction) {
  if (pending.transactionType === "reversal") return { field: "originalEntryId", question: "Which posted entry should be reversed? Open Books, choose the duplicate entry, and select Reverse so ACC can link the correction safely." };
  if (!pending.transactionType) return { field: "transactionType", question: "Was this income, an expense, a customer collection, a supplier payment, capital, an asset, a loan, a return, or something else?" };
  if (pending.amountPaise === null) return { field: "amountPaise", question: "What was the exact total amount? You can say, for example, ₹1.2 lakh or 10 items at ₹500 each." };
  if (!pending.category) return pending.transactionType === "income" ? { field: "category", question: "Was this earned from selling goods or providing a service?" } : { field: "category", question: `Which account best describes this ${transactionTypeLabel(pending.transactionType).toLowerCase()}?` };
  if (!pending.settlement) {
    if (pending.transactionType === "sales_return") return { field: "settlement", question: "Was the customer refunded in cash or bank, or should ACC reduce the amount they still owe?" };
    if (pending.transactionType === "purchase_return") return { field: "settlement", question: "Did the supplier refund cash or bank, or should ACC reduce the amount still payable?" };
    return { field: "settlement", question: "Did this move through cash, cheque/UPI/bank, or is the amount still due?" };
  }
  if (pending.inventoryRelevant && pending.inventoryCostStatus === "missing") return { field: "inventoryCostPaise", question: "What did the sold inventory cost the business? If you do not know yet, say “cost pending” and ACC will not invent it." };
  return null;
}

function financialEffect(pending: PendingTransaction) {
  const effects: Record<TransactionType, string> = {
    income: pending.settlement === "receivable" ? "Revenue and customer receivables increase." : "Revenue and available money increase.",
    expense: pending.settlement === "payable" ? "Expense and supplier payables increase." : "Expense increases and available money decreases.",
    capital_in: "Available money and owner capital increase; profit does not change.", drawings: "Available money and owner equity decrease; this is not a business expense.",
    asset_purchase: "A business asset increases; cash decreases or a payable increases.", liability_borrow: "Available money and liabilities increase by the same amount.", liability_repay: "Available money and the selected liability decrease.", investment_purchase: "Business investments increase and available money decreases.",
    bad_debt: "Receivables decrease and bad-debt expense reduces profit.", provision_create: "A provision liability and an expense increase; cash does not move now.", reserve_transfer: "Retained profit moves to a reserve; cash and total equity do not change.",
    receivable_collection: "Available money increases and customer receivables decrease. Revenue is not recorded again.", supplier_payment: "Available money and supplier payables decrease. Expense is not recorded again.",
    sales_return: "Sales returns increase and cash or receivables decrease.", purchase_return: "Cash increases or payables decrease, and purchase returns are recorded.",
    customer_advance: "Available money and the customer-advance liability increase; revenue is not recorded yet.", supplier_advance: "A supplier advance increases and available money decreases; expense is not recorded yet.",
    depreciation: "Depreciation expense and accumulated depreciation increase; cash does not move.", tax_payment: "Available money and the selected tax liability decrease.", reversal: "No reversal is posted until a specific posted entry is selected.",
  };
  return effects[pending.transactionType as TransactionType];
}

export function continueTransactionConversation(text: string, previous?: PendingTransaction | null): TransactionConversationResult {
  const cleaned = text.trim();
  if (!cleaned || (!previous && !transactionSignals.test(cleaned))) return { kind: "not_transaction" };
  const type = transactionTypeFrom(cleaned);
  const amount = amountDetails(cleaned, type);
  const date = explicitDate(cleaned);
  const category = categoryFrom(cleaned, type);
  let pending: PendingTransaction = previous ? mergeClarification(previous, cleaned) : {
    originalText: cleaned, description: cleaned.slice(0, 240), transactionType: type,
    amountPaise: amount.amountPaise, date: date?.date ?? todayISO(), dateSource: date?.source ?? "system_default_today",
    category, settlement: settlementFrom(cleaned, type), settlementBreakdown: settlementBreakdown(cleaned, amount.amountPaise),
    counterparty: counterpartyFrom(cleaned), inventoryRelevant: inventoryRelevant(cleaned, type, category), inventoryCostPaise: null,
    inventoryCostStatus: inventoryRelevant(cleaned, type, category) ? "missing" : "not_applicable",
    netAmountPaise: amount.netAmountPaise, taxPaise: amount.taxPaise, taxRateBps: amount.taxRateBps, taxAccount: amount.taxAccount,
    quantity: amount.quantity, unitPricePaise: amount.unitPricePaise, confidence: null,
  };
  if (!pending.inventoryRelevant && inventoryRelevant(pending.originalText, pending.transactionType, pending.category)) pending = { ...pending, inventoryRelevant: true, inventoryCostStatus: "missing" };
  const clarification = nextClarification(pending);
  if (clarification) return { kind: "clarification", pending, question: clarification.question, missingField: clarification.field };

  const draft: TransactionDraft = {
    idempotencyKey: crypto.randomUUID(), date: pending.date, description: pending.description ?? pending.originalText,
    amountPaise: pending.amountPaise as number, transactionType: pending.transactionType as TransactionType,
    category: pending.category as TransactionCategory, settlement: pending.settlement as SettlementAccount,
    settlementBreakdown: pending.settlementBreakdown, counterparty: pending.counterparty,
    inventoryCostStatus: pending.inventoryCostStatus === "confirmed" ? "confirmed" : pending.inventoryCostStatus === "pending" ? "pending" : "not_applicable",
    inventoryCostPaise: pending.inventoryCostPaise, netAmountPaise: pending.netAmountPaise ?? undefined,
    taxPaise: pending.taxPaise ?? undefined, taxRateBps: pending.taxRateBps ?? undefined, taxAccount: pending.taxAccount ?? undefined,
    quantity: pending.quantity ?? undefined, unitPricePaise: pending.unitPricePaise ?? undefined, sourceType: "ai_approved",
  };
  const baseLines = deriveJournalLines(draft);
  const journalLines = pending.inventoryCostStatus === "confirmed" && pending.inventoryCostPaise
    ? [...baseLines, { account: "Cost of Goods Sold", debitPaise: pending.inventoryCostPaise, creditPaise: 0 }, { account: "Inventory", debitPaise: 0, creditPaise: pending.inventoryCostPaise }]
    : baseLines;
  draft.journalLines = journalLines;
  return { kind: "proposal", pending, draft, journalLines, financialEffect: financialEffect(pending), sources: ["Your conversation", "ACC deterministic accounting rules", ...(pending.taxPaise ? ["GST arithmetic shown in the journal"] : [])] };
}
