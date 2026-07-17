import type {
  BusinessType,
  JournalLine,
  LegalStructure,
  MetricSource,
  MoneyMetric,
  PostedEntry,
  SettlementAccount,
  TransactionCategory,
  TransactionDraft,
  TransactionType,
  WorkspaceConfig,
} from "../components/types";
import { isSafePaise } from "./money";

type LabelOption<T extends string> = Readonly<{
  value: T;
  label: string;
}>;

export const BUSINESS_TYPES: readonly LabelOption<BusinessType>[] = [
  { value: "freelancer", label: "Freelancer" },
  { value: "retail", label: "Retail business" },
  { value: "service", label: "Service business" },
  { value: "ecommerce", label: "E-commerce business" },
  { value: "agency", label: "Agency" },
  { value: "manufacturing", label: "Manufacturing business" },
  { value: "nonprofit", label: "Non-profit organisation" },
  { value: "personal", label: "Personal accounts" },
  { value: "other", label: "Other" },
];

export const LEGAL_STRUCTURES: readonly LabelOption<LegalStructure>[] = [
  { value: "not_specified", label: "Not specified" },
  { value: "sole", label: "Sole proprietor" },
  { value: "partnership", label: "Partnership" },
  { value: "private", label: "Private company" },
];

type CategoryOption = LabelOption<TransactionCategory> &
  Readonly<{
    account: string;
    transactionType: TransactionType;
  }>;

export const INCOME_CATEGORIES: readonly CategoryOption[] = [
  {
    value: "sales_revenue",
    label: "Sales revenue",
    account: "Sales Revenue",
    transactionType: "income",
  },
  {
    value: "service_revenue",
    label: "Service revenue",
    account: "Service Revenue",
    transactionType: "income",
  },
];

export const EXPENSE_CATEGORIES: readonly CategoryOption[] = [
  {
    value: "rent_expense",
    label: "Rent",
    account: "Rent Expense",
    transactionType: "expense",
  },
  {
    value: "supplies_expense",
    label: "Supplies",
    account: "Supplies Expense",
    transactionType: "expense",
  },
  {
    value: "payroll_expense",
    label: "Payroll",
    account: "Payroll Expense",
    transactionType: "expense",
  },
  {
    value: "utilities_expense",
    label: "Utilities",
    account: "Utilities Expense",
    transactionType: "expense",
  },
  {
    value: "marketing_expense",
    label: "Marketing",
    account: "Marketing Expense",
    transactionType: "expense",
  },
  {
    value: "other_operating_expense",
    label: "Other operating expense",
    account: "Other Operating Expense",
    transactionType: "expense",
  },
];

export const CAPITAL_CATEGORIES: readonly CategoryOption[] = [
  { value: "owner_capital", label: "Owner / partner capital", account: "Owner's Capital", transactionType: "capital_in" },
];

export const DRAWING_CATEGORIES: readonly CategoryOption[] = [
  { value: "owner_drawings", label: "Owner / partner drawings", account: "Drawings", transactionType: "drawings" },
];

export const ASSET_CATEGORIES: readonly CategoryOption[] = [
  { value: "equipment_asset", label: "Equipment", account: "Equipment", transactionType: "asset_purchase" },
  { value: "furniture_asset", label: "Furniture", account: "Furniture", transactionType: "asset_purchase" },
  { value: "vehicle_asset", label: "Vehicle", account: "Vehicles", transactionType: "asset_purchase" },
  { value: "property_asset", label: "Property", account: "Property", transactionType: "asset_purchase" },
  { value: "inventory_asset", label: "Inventory / stock", account: "Inventory", transactionType: "asset_purchase" },
];

export const LIABILITY_CATEGORIES: readonly CategoryOption[] = [
  { value: "business_loan", label: "Business loan", account: "Business Loan", transactionType: "liability_borrow" },
  { value: "other_borrowing", label: "Other borrowing", account: "Other Borrowings", transactionType: "liability_borrow" },
];

export const INVESTMENT_CATEGORIES: readonly CategoryOption[] = [
  { value: "investment_asset", label: "Business investment", account: "Investments", transactionType: "investment_purchase" },
];

export const BAD_DEBT_CATEGORIES: readonly CategoryOption[] = [
  { value: "bad_debt_expense", label: "Bad debt written off", account: "Bad Debts Expense", transactionType: "bad_debt" },
];

export const PROVISION_CATEGORIES: readonly CategoryOption[] = [
  { value: "provision_expense", label: "Provision for an expected obligation", account: "Provision Expense", transactionType: "provision_create" },
];

export const RESERVE_CATEGORIES: readonly CategoryOption[] = [
  { value: "general_reserve", label: "General reserve", account: "General Reserve", transactionType: "reserve_transfer" },
  { value: "capital_reserve", label: "Capital reserve", account: "Capital Reserve", transactionType: "reserve_transfer" },
];

export const SETTLEMENT_CATEGORIES: readonly CategoryOption[] = [
  { value: "accounts_receivable", label: "Customer receivable", account: "Accounts Receivable", transactionType: "receivable_collection" },
  { value: "accounts_payable", label: "Supplier payable", account: "Accounts Payable", transactionType: "supplier_payment" },
  { value: "sales_returns", label: "Sales return / credit note", account: "Sales Returns", transactionType: "sales_return" },
  { value: "purchase_returns", label: "Purchase return / debit note", account: "Purchase Returns", transactionType: "purchase_return" },
  { value: "customer_advances", label: "Advance received from customer", account: "Customer Advances", transactionType: "customer_advance" },
  { value: "supplier_advances", label: "Advance paid to supplier", account: "Supplier Advances", transactionType: "supplier_advance" },
  { value: "depreciation_expense", label: "Depreciation", account: "Depreciation Expense", transactionType: "depreciation" },
  { value: "gst_payable", label: "GST payable", account: "GST Payable", transactionType: "tax_payment" },
  { value: "tds_payable", label: "TDS payable", account: "TDS Payable", transactionType: "tax_payment" },
  { value: "reversal_entry", label: "Reversal / correction", account: "Suspense", transactionType: "reversal" },
];

type SettlementOption = LabelOption<SettlementAccount> &
  Readonly<{
    account: string;
    permittedFor: readonly TransactionType[];
  }>;

export const SETTLEMENT_OPTIONS: readonly SettlementOption[] = [
  {
    value: "bank",
    label: "Bank account",
    account: "Bank",
    permittedFor: ["income", "expense", "capital_in", "drawings", "asset_purchase", "liability_borrow", "liability_repay", "investment_purchase", "receivable_collection", "supplier_payment", "sales_return", "purchase_return", "customer_advance", "supplier_advance", "tax_payment"],
  },
  {
    value: "cash",
    label: "Cash in hand",
    account: "Cash in Hand",
    permittedFor: ["income", "expense", "capital_in", "drawings", "asset_purchase", "liability_borrow", "liability_repay", "investment_purchase", "receivable_collection", "supplier_payment", "sales_return", "purchase_return", "customer_advance", "supplier_advance", "tax_payment"],
  },
  {
    value: "receivable",
    label: "Customer will pay later",
    account: "Accounts Receivable",
    permittedFor: ["income", "bad_debt", "sales_return", "receivable_collection"],
  },
  {
    value: "payable",
    label: "Supplier will be paid later",
    account: "Accounts Payable",
    permittedFor: ["expense", "asset_purchase", "purchase_return", "supplier_payment"],
  },
  {
    value: "not_applicable",
    label: "No cash movement",
    account: "",
    permittedFor: ["provision_create", "reserve_transfer", "depreciation", "reversal"],
  },
];

export const TRANSACTION_TYPES: readonly TransactionType[] = [
  "income", "expense", "capital_in", "drawings", "asset_purchase",
  "liability_borrow", "liability_repay", "investment_purchase",
  "bad_debt", "provision_create", "reserve_transfer",
  "receivable_collection", "supplier_payment", "sales_return", "purchase_return",
  "customer_advance", "supplier_advance", "depreciation", "tax_payment", "reversal",
];

const ALL_CATEGORIES = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  ...CAPITAL_CATEGORIES,
  ...DRAWING_CATEGORIES,
  ...ASSET_CATEGORIES,
  ...LIABILITY_CATEGORIES,
  ...INVESTMENT_CATEGORIES,
  ...BAD_DEBT_CATEGORIES,
  ...PROVISION_CATEGORIES,
  ...RESERVE_CATEGORIES,
  ...SETTLEMENT_CATEGORIES,
];

export function categoriesForTransactionType(value: TransactionType): readonly CategoryOption[] {
  if (value === "liability_repay") {
    return LIABILITY_CATEGORIES.map((item) => ({ ...item, transactionType: "liability_repay" as const }));
  }
  return ALL_CATEGORIES.filter((item) => item.transactionType === value);
}

function optionLabel<T extends string>(
  value: T,
  options: readonly LabelOption<T>[],
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function businessTypeLabel(value: BusinessType): string {
  return optionLabel(value, BUSINESS_TYPES);
}

export function legalStructureLabel(value: LegalStructure): string {
  return optionLabel(value, LEGAL_STRUCTURES);
}

export function categoryLabel(value: TransactionCategory): string {
  return optionLabel(value, ALL_CATEGORIES);
}

export function settlementLabel(value: SettlementAccount): string {
  return optionLabel(value, SETTLEMENT_OPTIONS);
}

export function transactionTypeLabel(value: TransactionType): string {
  const labels: Record<TransactionType, string> = {
    income: "Income",
    expense: "Expense",
    capital_in: "Capital introduced",
    drawings: "Drawings",
    asset_purchase: "Asset purchased",
    liability_borrow: "Liability added",
    liability_repay: "Liability repaid",
    investment_purchase: "Investment purchased",
    bad_debt: "Bad debt written off",
    provision_create: "Provision recognised",
    reserve_transfer: "Profit moved to reserve",
    receivable_collection: "Customer payment collected",
    supplier_payment: "Supplier balance paid",
    sales_return: "Sales return",
    purchase_return: "Purchase return",
    customer_advance: "Customer advance received",
    supplier_advance: "Supplier advance paid",
    depreciation: "Depreciation recorded",
    tax_payment: "Tax liability paid",
    reversal: "Entry reversed",
  };
  return labels[value];
}

export type TransactionDraftField = keyof TransactionDraft;

export type TransactionValidationResult =
  | { valid: true; errors: Record<string, never> }
  | {
      valid: false;
      errors: Partial<Record<TransactionDraftField, string>>;
    };

export function isValidISODate(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateTransactionDraft(
  draft: unknown,
): TransactionValidationResult {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      valid: false,
      errors: { description: "Enter the transaction details." },
    };
  }

  const candidate = draft as Partial<Record<TransactionDraftField, unknown>>;
  const errors: Partial<Record<TransactionDraftField, string>> = {};

  if (!isValidISODate(candidate.date)) {
    errors.date = "Choose a valid transaction date.";
  }

  if (
    typeof candidate.description !== "string" ||
    candidate.description.trim().length === 0
  ) {
    errors.description = "Describe what happened.";
  } else if (candidate.description.trim().length > 240) {
    errors.description = "Keep the description to 240 characters or fewer.";
  }

  if (!isSafePaise(candidate.amountPaise) || candidate.amountPaise <= 0) {
    errors.amountPaise = "Enter an amount greater than zero.";
  }

  const transactionType = TRANSACTION_TYPES.find((item) => item === candidate.transactionType);
  if (!transactionType) {
    errors.transactionType = "Choose what happened in the business.";
  }

  const category = ALL_CATEGORIES.find(
    (item) => item.value === candidate.category,
  );
  if (!category) {
    errors.category = "Choose a transaction category.";
  } else if (transactionType) {
    const permitted = categoriesForTransactionType(transactionType);
    if (!permitted.some((item) => item.value === category.value)) {
      errors.category = `Choose a category for ${transactionTypeLabel(transactionType).toLowerCase()}.`;
    }
  }

  const settlement = SETTLEMENT_OPTIONS.find(
    (item) => item.value === candidate.settlement,
  );
  if (!settlement) {
    errors.settlement = "Choose where the money was paid or received.";
  } else if (transactionType && !settlement.permittedFor.includes(transactionType)) {
    errors.settlement = "Choose a valid money source or destination for this action.";
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true, errors: {} };
}

export function deriveJournalLines(draft: TransactionDraft): JournalLine[] {
  const validation = validateTransactionDraft(draft);
  if (!validation.valid) {
    throw new TypeError(Object.values(validation.errors).join(" "));
  }

  const category = ALL_CATEGORIES.find((item) => item.value === draft.category);
  const settlement = SETTLEMENT_OPTIONS.find(
    (item) => item.value === draft.settlement,
  );

  if (!category || !settlement) {
    throw new TypeError("The transaction classification is incomplete.");
  }

  const settlementLines = draft.settlementBreakdown?.length
    ? draft.settlementBreakdown.map((part) => {
        const option = SETTLEMENT_OPTIONS.find((item) => item.value === part.settlement);
        if (!option || !Number.isSafeInteger(part.amountPaise) || part.amountPaise <= 0) throw new TypeError("Settlement split is invalid.");
        return { account: option.account, amountPaise: part.amountPaise };
      })
    : null;
  if (settlementLines && settlementLines.reduce((sum, line) => safeAdd(sum, line.amountPaise), 0) !== draft.amountPaise) {
    throw new TypeError("Settlement split must equal the transaction amount.");
  }

  if (draft.journalLines?.length) {
    if (draft.journalLines.length < 2 || draft.journalLines.length > 12) {
      throw new TypeError("A journal entry must contain between two and twelve lines.");
    }
    const lines = draft.journalLines.map((line) => {
      if (!line.account.trim() || line.account.length > 120) {
        throw new TypeError("Every journal line must use a valid account name.");
      }
      if (!isSafePaise(line.debitPaise) || !isSafePaise(line.creditPaise) || line.debitPaise < 0 || line.creditPaise < 0) {
        throw new TypeError("Journal lines must use non-negative exact paise.");
      }
      if ((line.debitPaise === 0) === (line.creditPaise === 0)) {
        throw new TypeError("Every journal line must contain either a debit or a credit.");
      }
      return { ...line };
    });
    const debits = lines.reduce((total, line) => safeAdd(total, line.debitPaise), 0);
    const credits = lines.reduce((total, line) => safeAdd(total, line.creditPaise), 0);
    if (debits !== credits) throw new TypeError("Total debit must equal total credit.");
    if (debits < draft.amountPaise) throw new TypeError("Journal lines do not cover the transaction amount.");
    return lines;
  }

  if (draft.transactionType === "receivable_collection") {
    return [{ account: settlement.account, debitPaise: draft.amountPaise, creditPaise: 0 }, { account: "Accounts Receivable", debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "supplier_payment") {
    return [{ account: "Accounts Payable", debitPaise: draft.amountPaise, creditPaise: 0 }, { account: settlement.account, debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "sales_return") {
    return [{ account: "Sales Returns", debitPaise: draft.amountPaise, creditPaise: 0 }, { account: settlement.account, debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "purchase_return") {
    return [{ account: settlement.account, debitPaise: draft.amountPaise, creditPaise: 0 }, { account: "Purchase Returns", debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "customer_advance") {
    return [{ account: settlement.account, debitPaise: draft.amountPaise, creditPaise: 0 }, { account: "Customer Advances", debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "supplier_advance") {
    return [{ account: "Supplier Advances", debitPaise: draft.amountPaise, creditPaise: 0 }, { account: settlement.account, debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "depreciation") {
    return [{ account: "Depreciation Expense", debitPaise: draft.amountPaise, creditPaise: 0 }, { account: "Accumulated Depreciation", debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "tax_payment") {
    return [{ account: category.account, debitPaise: draft.amountPaise, creditPaise: 0 }, { account: settlement.account, debitPaise: 0, creditPaise: draft.amountPaise }];
  }
  if (draft.transactionType === "reversal") throw new TypeError("A reversal must be generated from a selected posted entry.");

  if (draft.taxPaise && draft.netAmountPaise && draft.taxAccount) {
    if (draft.netAmountPaise + draft.taxPaise !== draft.amountPaise) throw new TypeError("GST split does not equal the transaction amount.");
    if (draft.transactionType === "income") return [
      { account: settlement.account, debitPaise: draft.amountPaise, creditPaise: 0 },
      { account: category.account, debitPaise: 0, creditPaise: draft.netAmountPaise },
      { account: draft.taxAccount, debitPaise: 0, creditPaise: draft.taxPaise },
    ];
    return [
      { account: category.account, debitPaise: draft.netAmountPaise, creditPaise: 0 },
      { account: draft.taxAccount, debitPaise: draft.taxPaise, creditPaise: 0 },
      { account: settlement.account, debitPaise: 0, creditPaise: draft.amountPaise },
    ];
  }

  if (settlementLines && (draft.transactionType === "asset_purchase" || draft.transactionType === "expense")) {
    return [
      { account: category.account, debitPaise: draft.amountPaise, creditPaise: 0 },
      ...settlementLines.map((line) => ({ account: line.account, debitPaise: 0, creditPaise: line.amountPaise })),
    ];
  }

  if (draft.transactionType === "income" || draft.transactionType === "capital_in" || draft.transactionType === "liability_borrow") {
    return [
      {
        account: settlement.account,
        debitPaise: draft.amountPaise,
        creditPaise: 0,
      },
      {
        account: category.account,
        debitPaise: 0,
        creditPaise: draft.amountPaise,
      },
    ];
  }

  if (draft.transactionType === "bad_debt") {
    return [
      { account: category.account, debitPaise: draft.amountPaise, creditPaise: 0 },
      { account: "Accounts Receivable", debitPaise: 0, creditPaise: draft.amountPaise },
    ];
  }

  if (draft.transactionType === "provision_create") {
    return [
      { account: category.account, debitPaise: draft.amountPaise, creditPaise: 0 },
      { account: "Provision for Expenses", debitPaise: 0, creditPaise: draft.amountPaise },
    ];
  }

  if (draft.transactionType === "reserve_transfer") {
    return [
      { account: "Retained Earnings", debitPaise: draft.amountPaise, creditPaise: 0 },
      { account: category.account, debitPaise: 0, creditPaise: draft.amountPaise },
    ];
  }

  if (draft.transactionType === "liability_repay") {
    return [
      { account: category.account, debitPaise: draft.amountPaise, creditPaise: 0 },
      { account: settlement.account, debitPaise: 0, creditPaise: draft.amountPaise },
    ];
  }

  return [
    {
      account: category.account,
      debitPaise: draft.amountPaise,
      creditPaise: 0,
    },
    {
      account: settlement.account,
      debitPaise: 0,
      creditPaise: draft.amountPaise,
    },
  ];
}

export type DateRange = Readonly<{
  startDate: string;
  endDate: string;
}>;

export function validateDateRange(range: DateRange): DateRange {
  if (!isValidISODate(range.startDate) || !isValidISODate(range.endDate)) {
    throw new TypeError("A date range must use valid YYYY-MM-DD dates.");
  }
  if (range.startDate > range.endDate) {
    throw new RangeError("The start date must not be after the end date.");
  }
  return range;
}

function isoDateFromUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDateFromISO(value: string): Date {
  if (!isValidISODate(value)) throw new TypeError("Expected a valid YYYY-MM-DD date.");
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function monthToDateRange(asOfDate: string): DateRange {
  const asOf = utcDateFromISO(asOfDate);
  return {
    startDate: isoDateFromUTC(
      new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1)),
    ),
    endDate: asOfDate,
  };
}

export function financialYearToDateRange(asOfDate: string): DateRange {
  const asOf = utcDateFromISO(asOfDate);
  const year = asOf.getUTCFullYear();
  const startYear = asOf.getUTCMonth() >= 3 ? year : year - 1;
  return {
    startDate: `${startYear}-04-01`,
    endDate: asOfDate,
  };
}

export function formatDisplayDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDateFromISO(value));
}

export function formatDateRange(range: DateRange): string {
  validateDateRange(range);
  if (range.startDate === range.endDate) return formatDisplayDate(range.startDate);
  return `${formatDisplayDate(range.startDate)} – ${formatDisplayDate(range.endDate)}`;
}

export function filterEntriesByDateRange(
  entries: readonly PostedEntry[],
  range: DateRange,
): PostedEntry[] {
  validateDateRange(range);
  if (entries.some((entry) => !isValidISODate(entry.date))) {
    throw new TypeError("Every transaction must have a valid transaction date.");
  }
  return entries.filter(
    (entry) => entry.date >= range.startDate && entry.date <= range.endDate,
  );
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("The calculated amount exceeds the safe paise range.");
  }
  return result;
}

function safeSubtract(left: number, right: number): number {
  return safeAdd(left, -right);
}

function sumPaise(values: readonly number[]): number {
  return values.reduce(safeAdd, 0);
}

function assertWorkspaceBalances(config: WorkspaceConfig): void {
  if (!isSafePaise(config.openingBankPaise) || config.openingBankPaise < 0) {
    throw new RangeError("Opening bank balance is not valid integer paise.");
  }
  if (!isSafePaise(config.cashInHandPaise) || config.cashInHandPaise < 0) {
    throw new RangeError("Opening cash in hand is not valid integer paise.");
  }
  if (!isSafePaise(config.openingCapitalPaise) || config.openingCapitalPaise < 0) {
    throw new RangeError("Opening capital is not valid integer paise.");
  }
  safeAdd(safeAdd(config.openingBankPaise, config.cashInHandPaise), config.openingCapitalPaise);
}

function assertPostedEntries(entries: readonly PostedEntry[]): void {
  const ids = new Set<string>();

  for (const entry of entries) {
    const validation = validateTransactionDraft(entry);
    if (!validation.valid) {
      throw new TypeError(
        `Entry ${entry.id || "without an id"} is invalid: ${Object.values(
          validation.errors,
        ).join(" ")}`,
      );
    }
    if (entry.status !== "posted") {
      throw new TypeError(`Entry ${entry.id} is not posted.`);
    }
    if (!entry.id || ids.has(entry.id)) {
      throw new TypeError("Posted entry ids must be present and unique.");
    }
    ids.add(entry.id);

    const lines = deriveJournalLines(entry);
    if (
      entry.debitAccount !== lines[0].account ||
      entry.creditAccount !== lines[1].account
    ) {
      throw new TypeError(`Entry ${entry.id} does not match its classification.`);
    }
  }
}

function latestUpdatedAt(
  config: WorkspaceConfig,
  entries: readonly PostedEntry[],
): number | undefined {
  const candidates = [config.updatedAt, ...entries.map((entry) => entry.createdAt)].filter(
    (value): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  );
  return candidates.length ? Math.max(...candidates) : undefined;
}

function metric(
  amountPaise: number,
  source: MetricSource,
  sourceLabel: string,
  updatedAt?: number,
): MoneyMetric {
  if (!isSafePaise(amountPaise)) {
    throw new RangeError("A financial metric exceeded the safe paise range.");
  }
  return {
    amountPaise,
    source,
    sourceLabel,
    ...(updatedAt === undefined ? {} : { lastUpdatedAt: updatedAt }),
  };
}

function signedAmount(entry: PostedEntry): number {
  const account = entry.settlement === "bank" ? "Bank" : entry.settlement === "cash" ? "Cash in Hand" : null;
  if (!account) return 0;
  const line = deriveJournalLines(entry).find((item) => item.account === account);
  return line ? safeSubtract(line.debitPaise, line.creditPaise) : 0;
}

function recognisedRevenuePaise(entry: PostedEntry): number {
  return sumPaise(deriveJournalLines(entry)
    .filter((line) => accountTypeFor(line.account) === "income")
    .map((line) => safeSubtract(line.creditPaise, line.debitPaise)));
}

function recognisedExpensePaise(entry: PostedEntry): number {
  return sumPaise(deriveJournalLines(entry)
    .filter((line) => accountTypeFor(line.account) === "expense")
    .map((line) => safeSubtract(line.debitPaise, line.creditPaise)));
}

function entriesUpTo(
  entries: readonly PostedEntry[],
  endDate?: string,
): PostedEntry[] {
  return endDate ? entries.filter((entry) => entry.date <= endDate) : [...entries];
}

function inferredRange(entries: readonly PostedEntry[]): DateRange | null {
  if (!entries.length) return null;
  const dates = entries.map((entry) => entry.date).sort();
  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

function workspaceAsOfDate(config: WorkspaceConfig): string | null {
  const timestamp = config.setupCompletedAt ?? config.updatedAt;
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  ) {
    return null;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : isoDateFromUTC(date);
}

export type FinancialSummary = Readonly<{
  cashAtBank: MoneyMetric;
  cashInHand: MoneyMetric;
  availableCash: MoneyMetric;
  revenue: MoneyMetric;
  expenses: MoneyMetric;
  receivables: MoneyMetric;
  payables: MoneyMetric;
  netCashFlow: MoneyMetric;
  profit: MoneyMetric | null;
  openingCashPaise: number;
  cashInflowsPaise: number;
  cashOutflowsPaise: number;
  closingCashPaise: number;
  totalAssetsPaise: number;
  totalLiabilitiesPaise: number;
  capitalPaise: number;
  drawingsPaise: number;
  reservesPaise: number;
  fixedAssetsPaise: number;
  investmentsPaise: number;
  borrowingsPaise: number;
  equityPaise: number | null;
  balanceSheetReady: boolean;
  balanceSheetReason: string | null;
  balanceSheetDifferencePaise: number;
  hasTransactionHistory: boolean;
  transactionCount: number;
  asOfDate: string | null;
  flowPeriod: DateRange | null;
  latestUpdatedAt?: number;
}>;

/**
 * Calculates all dashboard metrics from the workspace opening balances and
 * posted entries. A supplied period limits flow metrics to that period while
 * balance metrics include all entries up to the period end date.
 */
export function calculateFinancialSummary(
  config: WorkspaceConfig,
  entries: readonly PostedEntry[],
  period?: DateRange,
): FinancialSummary {
  assertWorkspaceBalances(config);
  assertPostedEntries(entries);
  if (period) validateDateRange(period);

  const balanceEntries = entriesUpTo(entries, period?.endDate);
  const flowEntries = period
    ? filterEntriesByDateRange(entries, period)
    : [...entries];

  const balances = calculateAccountBalances(config, balanceEntries);
  const accountValue = (name: string) => balances.accounts.find((row) => row.account === name)?.balancePaise ?? 0;
  const bankEntries = balanceEntries.filter((entry) => entry.settlement === "bank");
  const cashEntries = balanceEntries.filter((entry) => entry.settlement === "cash");
  const cashAtBankPaise = accountValue("Bank");
  const cashInHandPaise = accountValue("Cash in Hand");
  const availableCashPaise = safeAdd(cashAtBankPaise, cashInHandPaise);

  const incomeEntries = flowEntries.filter((entry) => recognisedRevenuePaise(entry) !== 0);
  const expenseEntries = flowEntries.filter((entry) => recognisedExpensePaise(entry) !== 0);
  const revenuePaise = sumPaise(incomeEntries.map(recognisedRevenuePaise));
  const expensesPaise = sumPaise(expenseEntries.map(recognisedExpensePaise));

  const flowCashEntries = flowEntries.filter(
    (entry) => entry.settlement === "bank" || entry.settlement === "cash",
  );
  const cashMovements = flowCashEntries.map(signedAmount);
  const cashInflowsPaise = sumPaise(cashMovements.filter((amount) => amount > 0));
  const cashOutflowsPaise = sumPaise(cashMovements.filter((amount) => amount < 0).map((amount) => -amount));
  const netCashFlowPaise = safeSubtract(cashInflowsPaise, cashOutflowsPaise);

  const receivablesPaise = accountValue("Accounts Receivable");
  const payablesPaise = accountValue("Accounts Payable");
  const configuredOpeningCashPaise = safeAdd(
    config.openingBankPaise,
    config.cashInHandPaise,
  );
  const priorCashEntries = period
    ? balanceEntries.filter(
        (entry) =>
          entry.date < period.startDate &&
          (entry.settlement === "bank" || entry.settlement === "cash"),
      )
    : [];
  const openingCashPaise = safeAdd(
    configuredOpeningCashPaise,
    sumPaise(priorCashEntries.map(signedAmount)),
  );
  const totalAssetsPaise = sumPaise(balances.accounts.filter((row) => row.accountType === "asset").map((row) => row.balancePaise));
  const totalLiabilitiesPaise = sumPaise(balances.accounts.filter((row) => row.accountType === "liability").map((row) => row.balancePaise));
  const explicitEquityPaise = sumPaise(balances.accounts.filter((row) => row.accountType === "equity").map((row) => row.balancePaise));
  const lifetimeRevenuePaise = sumPaise(balanceEntries.map(recognisedRevenuePaise));
  const lifetimeExpensePaise = sumPaise(balanceEntries.map(recognisedExpensePaise));
  const lifetimeProfitPaise = safeSubtract(lifetimeRevenuePaise, lifetimeExpensePaise);
  const calculatedEquityPaise = safeAdd(explicitEquityPaise, lifetimeProfitPaise);
  const assetsLessClaimsPaise = safeSubtract(totalAssetsPaise, safeAdd(totalLiabilitiesPaise, calculatedEquityPaise));
  const balanceSheetReady = assetsLessClaimsPaise === 0 && balances.isBalanced;
  const balanceSheetReason = balanceSheetReady
    ? null
    : "Opening assets and their funding sources do not match yet.";
  const equityPaise = balanceSheetReady ? calculatedEquityPaise : null;
  const capitalPaise = accountValue("Owner's Capital");
  const drawingsPaise = -Math.min(0, accountValue("Drawings"));
  const reservesPaise = safeAdd(accountValue("General Reserve"), accountValue("Capital Reserve"));
  const fixedAssetsPaise = sumPaise(["Equipment", "Furniture", "Vehicles", "Property", "Inventory"].map(accountValue));
  const investmentsPaise = accountValue("Investments");
  const borrowingsPaise = safeAdd(accountValue("Business Loan"), accountValue("Other Borrowings"));

  const updatedAt = latestUpdatedAt(config, balanceEntries);
  const hasCashBalanceEvidence =
    configuredOpeningCashPaise !== 0 ||
    bankEntries.length > 0 ||
    cashEntries.length > 0;

  const bankMetricSource: MetricSource = bankEntries.length
    ? "transaction_aggregation"
    : config.openingBankPaise !== 0
      ? "opening_balance"
      : "zero";
  const cashMetricSource: MetricSource = cashEntries.length
    ? "transaction_aggregation"
    : config.cashInHandPaise !== 0
      ? "opening_balance"
      : "zero";

  const flowRange = period ?? inferredRange(flowEntries);
  const asOfDate =
    period?.endDate ??
    inferredRange(balanceEntries)?.endDate ??
    workspaceAsOfDate(config);

  return {
    cashAtBank: metric(
      cashAtBankPaise,
      bankMetricSource,
      bankEntries.length
        ? "Opening bank balance plus posted bank transactions"
        : config.openingBankPaise !== 0
          ? "Opening bank balance entered during setup"
          : "No opening bank balance or posted bank transactions",
      updatedAt,
    ),
    cashInHand: metric(
      cashInHandPaise,
      cashMetricSource,
      cashEntries.length
        ? "Opening cash in hand plus posted cash transactions"
        : config.cashInHandPaise !== 0
          ? "Opening cash in hand entered during setup"
          : "No opening cash in hand or posted cash transactions",
      updatedAt,
    ),
    availableCash: metric(
      availableCashPaise,
      hasCashBalanceEvidence ? "journal_calculation" : "zero",
      "Cash at bank plus cash in hand; excludes receivables and projected income",
      updatedAt,
    ),
    revenue: metric(
      revenuePaise,
      incomeEntries.length ? "transaction_aggregation" : "zero",
      incomeEntries.length
        ? "Posted transactions classified as revenue"
        : "No posted revenue transactions in this period",
      updatedAt,
    ),
    expenses: metric(
      expensesPaise,
      expenseEntries.length ? "transaction_aggregation" : "zero",
      expenseEntries.length
        ? "Posted transactions classified as expenses"
        : "No posted expense transactions in this period",
      updatedAt,
    ),
    receivables: metric(
      receivablesPaise,
      receivablesPaise !== 0 ? "transaction_aggregation" : "zero",
      receivablesPaise !== 0
        ? "Accounts Receivable balance after posted sales and bad-debt write-offs"
        : "No posted customer receivables",
      updatedAt,
    ),
    payables: metric(
      payablesPaise,
      payablesPaise !== 0 ? "transaction_aggregation" : "zero",
      payablesPaise !== 0
        ? "Accounts Payable balance after posted purchases and expenses"
        : "No posted supplier payables",
      updatedAt,
    ),
    netCashFlow: metric(
      netCashFlowPaise,
      flowCashEntries.length ? "transaction_aggregation" : "zero",
      flowCashEntries.length
        ? "Posted cash and bank inflows minus posted cash and bank outflows"
        : "No posted cash or bank movements in this period",
      updatedAt,
    ),
    profit:
      incomeEntries.length === 0 && expenseEntries.length === 0
        ? null
        : metric(
            safeSubtract(revenuePaise, expensesPaise),
            "journal_calculation",
            "Posted revenue minus posted recognised expenses",
            updatedAt,
          ),
    openingCashPaise,
    cashInflowsPaise,
    cashOutflowsPaise,
    closingCashPaise: availableCashPaise,
    totalAssetsPaise,
    totalLiabilitiesPaise,
    capitalPaise,
    drawingsPaise,
    reservesPaise,
    fixedAssetsPaise,
    investmentsPaise,
    borrowingsPaise,
    equityPaise,
    balanceSheetReady,
    balanceSheetReason,
    balanceSheetDifferencePaise: assetsLessClaimsPaise,
    hasTransactionHistory: flowEntries.length > 0,
    transactionCount: flowEntries.length,
    asOfDate,
    flowPeriod: flowRange,
    ...(updatedAt === undefined ? {} : { latestUpdatedAt: updatedAt }),
  };
}

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type NormalSide = "debit" | "credit";

export type AccountBalance = Readonly<{
  account: string;
  accountType: AccountType;
  normalSide: NormalSide;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  source: MetricSource;
  sourceLabel: string;
  lastTransactionDate: string | null;
}>;

export type AccountBalances = Readonly<{
  accounts: readonly AccountBalance[];
  totalDebitsPaise: number;
  totalCreditsPaise: number;
  isBalanced: boolean;
}>;

function accountTypeFor(account: string): AccountType {
  if (["Bank", "Cash in Hand", "Accounts Receivable", "Supplier Advances", "Input GST", "Equipment", "Furniture", "Vehicles", "Property", "Inventory", "Investments", "Goodwill", "Accumulated Depreciation"].includes(account)) {
    return "asset";
  }
  if (["Accounts Payable", "Customer Advances", "Business Loan", "Other Borrowings", "Provision for Expenses", "GST Payable", "TDS Payable", "Output GST"].includes(account)) return "liability";
  if (["Owner's Capital", "Drawings", "General Reserve", "Capital Reserve", "Retained Earnings"].includes(account)) return "equity";
  if (account.endsWith("Revenue") || account === "Sales Returns") return "income";
  return "expense";
}

const ACCOUNT_CATALOG = [
  "Bank", "Cash in Hand", "Accounts Receivable", "Supplier Advances", "Input GST", "Inventory", "Investments",
  "Equipment", "Furniture", "Vehicles", "Property", "Accounts Payable",
  "Accumulated Depreciation", "Customer Advances", "Business Loan", "Other Borrowings", "Provision for Expenses", "GST Payable", "TDS Payable", "Output GST", "Owner's Capital",
  "Drawings", "General Reserve", "Capital Reserve", "Retained Earnings",
  "Sales Revenue", "Service Revenue", "Rent Expense", "Supplies Expense",
  "Payroll Expense", "Utilities Expense", "Marketing Expense", "Other Operating Expense",
  "Bad Debts Expense", "Provision Expense", "Cost of Goods Sold", "Depreciation Expense", "Sales Returns", "Purchase Returns",
] as const;

function normalSideFor(accountType: AccountType): NormalSide {
  return accountType === "asset" || accountType === "expense" ? "debit" : "credit";
}

type MutableAccount = {
  account: string;
  accountType: AccountType;
  debitPaise: number;
  creditPaise: number;
  source: MetricSource;
  sourceLabel: string;
  lastTransactionDate: string | null;
};

function addToAccount(
  accounts: Map<string, MutableAccount>,
  account: string,
  debitPaise: number,
  creditPaise: number,
  source: MetricSource,
  sourceLabel: string,
  transactionDate: string | null,
): void {
  const existing = accounts.get(account) ?? {
    account,
    accountType: accountTypeFor(account),
    debitPaise: 0,
    creditPaise: 0,
    source,
    sourceLabel,
    lastTransactionDate: null,
  };

  existing.debitPaise = safeAdd(existing.debitPaise, debitPaise);
  existing.creditPaise = safeAdd(existing.creditPaise, creditPaise);
  if (source === "transaction_aggregation") {
    existing.source = source;
    existing.sourceLabel = sourceLabel;
  } else if (existing.source === "zero" && source === "opening_balance") {
    existing.source = source;
    existing.sourceLabel = sourceLabel;
  }
  if (
    transactionDate &&
    (!existing.lastTransactionDate || transactionDate > existing.lastTransactionDate)
  ) {
    existing.lastTransactionDate = transactionDate;
  }
  accounts.set(account, existing);
}

export function calculateAccountBalances(
  config: WorkspaceConfig,
  entries: readonly PostedEntry[],
): AccountBalances {
  assertWorkspaceBalances(config);
  assertPostedEntries(entries);

  const accounts = new Map<string, MutableAccount>();
  addToAccount(
    accounts,
    "Bank",
    config.openingBankPaise,
    0,
    config.openingBankPaise ? "opening_balance" : "zero",
    config.openingBankPaise
      ? "Opening bank balance entered during setup"
      : "No opening balance or posted movement",
    null,
  );
  addToAccount(
    accounts,
    "Owner's Capital",
    0,
    config.openingCapitalPaise,
    config.openingCapitalPaise ? "opening_balance" : "zero",
    config.openingCapitalPaise
      ? "Opening capital entered during setup"
      : "No opening capital or posted movement",
    null,
  );
  addToAccount(
    accounts,
    "Cash in Hand",
    config.cashInHandPaise,
    0,
    config.cashInHandPaise ? "opening_balance" : "zero",
    config.cashInHandPaise
      ? "Opening cash in hand entered during setup"
      : "No opening balance or posted movement",
    null,
  );

  for (const account of ACCOUNT_CATALOG) {
    if (accounts.has(account)) continue;
    addToAccount(accounts, account, 0, 0, "zero", "No opening balance or posted movement", null);
  }

  for (const entry of entries) {
    for (const line of deriveJournalLines(entry)) {
      addToAccount(
        accounts,
        line.account,
        line.debitPaise,
        line.creditPaise,
        "transaction_aggregation",
        "Posted journal transactions",
        entry.date,
      );
    }
  }

  const rows = [...accounts.values()]
    .map<AccountBalance>((account) => {
      const normalSide = normalSideFor(account.accountType);
      const balancePaise =
        normalSide === "debit"
          ? safeSubtract(account.debitPaise, account.creditPaise)
          : safeSubtract(account.creditPaise, account.debitPaise);
      return { ...account, normalSide, balancePaise };
    })
    .sort((left, right) => left.account.localeCompare(right.account));

  const totalDebitsPaise = sumPaise(rows.map((row) => row.debitPaise));
  const totalCreditsPaise = sumPaise(rows.map((row) => row.creditPaise));
  return {
    accounts: rows,
    totalDebitsPaise,
    totalCreditsPaise,
    isBalanced: totalDebitsPaise === totalCreditsPaise,
  };
}

export type TrialBalanceRow = Readonly<{
  account: string;
  debitPaise: number;
  creditPaise: number;
}>;

export type TrialBalance = Readonly<{
  rows: readonly TrialBalanceRow[];
  totalDebitsPaise: number;
  totalCreditsPaise: number;
  isBalanced: boolean;
}>;

/** Trial balance for real posted entries only; opening balances are excluded. */
export function calculateTrialBalance(
  entries: readonly PostedEntry[],
): TrialBalance {
  assertPostedEntries(entries);
  const accounts = new Map<string, { debitPaise: number; creditPaise: number }>();

  for (const entry of entries) {
    for (const line of deriveJournalLines(entry)) {
      const total = accounts.get(line.account) ?? { debitPaise: 0, creditPaise: 0 };
      total.debitPaise = safeAdd(total.debitPaise, line.debitPaise);
      total.creditPaise = safeAdd(total.creditPaise, line.creditPaise);
      accounts.set(line.account, total);
    }
  }

  const rows = [...accounts.entries()]
    .map<TrialBalanceRow>(([account, totals]) => {
      const netDebit = safeSubtract(totals.debitPaise, totals.creditPaise);
      return {
        account,
        debitPaise: netDebit >= 0 ? netDebit : 0,
        creditPaise: netDebit < 0 ? -netDebit : 0,
      };
    })
    .sort((left, right) => left.account.localeCompare(right.account));
  const totalDebitsPaise = sumPaise(rows.map((row) => row.debitPaise));
  const totalCreditsPaise = sumPaise(rows.map((row) => row.creditPaise));

  return {
    rows,
    totalDebitsPaise,
    totalCreditsPaise,
    isBalanced: totalDebitsPaise === totalCreditsPaise,
  };
}

export type LedgerLine = Readonly<{
  entryId: string;
  entryNumber: string;
  date: string;
  description: string;
  debitPaise: number;
  creditPaise: number;
  runningDebitMinusCreditPaise: number;
}>;

/** Ledger for a named account, derived only from posted journal entries. */
export function calculateLedger(
  entries: readonly PostedEntry[],
  account: string,
): readonly LedgerLine[] {
  assertPostedEntries(entries);
  if (!account.trim()) throw new TypeError("Choose an account for the ledger.");

  const sorted = [...entries].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.entryNumber.localeCompare(right.entryNumber),
  );
  let running = 0;
  const lines: LedgerLine[] = [];

  for (const entry of sorted) {
    const line = deriveJournalLines(entry).find((item) => item.account === account);
    if (!line) continue;
    running = safeAdd(running, safeSubtract(line.debitPaise, line.creditPaise));
    lines.push({
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      date: entry.date,
      description: entry.description,
      debitPaise: line.debitPaise,
      creditPaise: line.creditPaise,
      runningDebitMinusCreditPaise: running,
    });
  }
  return lines;
}

export type CashBridge = Readonly<{
  openingCashPaise: number;
  cashInflowsPaise: number;
  cashOutflowsPaise: number;
  netCashFlowPaise: number;
  closingCashPaise: number;
  transactionCount: number;
  period: DateRange | null;
}>;

function cashEntriesOnly(entries: readonly PostedEntry[]): PostedEntry[] {
  return entries.filter(
    (entry) => entry.settlement === "bank" || entry.settlement === "cash",
  );
}

export function buildCashBridge(
  config: WorkspaceConfig,
  entries: readonly PostedEntry[],
  period?: DateRange,
): CashBridge {
  assertWorkspaceBalances(config);
  assertPostedEntries(entries);
  if (period) validateDateRange(period);

  const allCashEntries = cashEntriesOnly(entries);
  const priorCashEntries = period
    ? allCashEntries.filter((entry) => entry.date < period.startDate)
    : [];
  const selectedCashEntries = period
    ? filterEntriesByDateRange(allCashEntries, period)
    : allCashEntries;
  const configuredOpening = safeAdd(
    config.openingBankPaise,
    config.cashInHandPaise,
  );
  const openingCashPaise = safeAdd(
    configuredOpening,
    sumPaise(priorCashEntries.map(signedAmount)),
  );
  const movements = selectedCashEntries.map(signedAmount);
  const cashInflowsPaise = sumPaise(movements.filter((amount) => amount > 0));
  const cashOutflowsPaise = sumPaise(movements.filter((amount) => amount < 0).map((amount) => -amount));
  const netCashFlowPaise = safeSubtract(cashInflowsPaise, cashOutflowsPaise);

  return {
    openingCashPaise,
    cashInflowsPaise,
    cashOutflowsPaise,
    netCashFlowPaise,
    closingCashPaise: safeAdd(openingCashPaise, netCashFlowPaise),
    transactionCount: selectedCashEntries.length,
    period: period ?? inferredRange(selectedCashEntries),
  };
}

export type CashHistoryPoint = Readonly<{
  date: string;
  cashInflowsPaise: number;
  cashOutflowsPaise: number;
  netCashFlowPaise: number;
  cashAtBankPaise: number;
  cashInHandPaise: number;
  availableCashPaise: number;
  transactionCount: number;
}>;

/** Returns one truthful point per actual cash-transaction date; never filler data. */
export function buildCashHistoryData(
  config: WorkspaceConfig,
  entries: readonly PostedEntry[],
  period?: DateRange,
): readonly CashHistoryPoint[] {
  assertWorkspaceBalances(config);
  assertPostedEntries(entries);
  if (period) validateDateRange(period);

  const cashEntries = cashEntriesOnly(entries);
  const before = period
    ? cashEntries.filter((entry) => entry.date < period.startDate)
    : [];
  const selected = period
    ? filterEntriesByDateRange(cashEntries, period)
    : cashEntries;

  let bankPaise = safeAdd(
    config.openingBankPaise,
    sumPaise(
      before
        .filter((entry) => entry.settlement === "bank")
        .map(signedAmount),
    ),
  );
  let cashPaise = safeAdd(
    config.cashInHandPaise,
    sumPaise(
      before
        .filter((entry) => entry.settlement === "cash")
        .map(signedAmount),
    ),
  );

  const grouped = new Map<string, PostedEntry[]>();
  for (const entry of selected) {
    const group = grouped.get(entry.date) ?? [];
    group.push(entry);
    grouped.set(entry.date, group);
  }

  const points: CashHistoryPoint[] = [];
  for (const date of [...grouped.keys()].sort()) {
    const dayEntries = grouped.get(date) ?? [];
    const movements = dayEntries.map(signedAmount);
    const cashInflowsPaise = sumPaise(movements.filter((amount) => amount > 0));
    const cashOutflowsPaise = sumPaise(movements.filter((amount) => amount < 0).map((amount) => -amount));
    const netCashFlowPaise = safeSubtract(cashInflowsPaise, cashOutflowsPaise);
    bankPaise = safeAdd(
      bankPaise,
      sumPaise(
        dayEntries
          .filter((entry) => entry.settlement === "bank")
          .map(signedAmount),
      ),
    );
    cashPaise = safeAdd(
      cashPaise,
      sumPaise(
        dayEntries
          .filter((entry) => entry.settlement === "cash")
          .map(signedAmount),
      ),
    );
    points.push({
      date,
      cashInflowsPaise,
      cashOutflowsPaise,
      netCashFlowPaise,
      cashAtBankPaise: bankPaise,
      cashInHandPaise: cashPaise,
      availableCashPaise: safeAdd(bankPaise, cashPaise),
      transactionCount: dayEntries.length,
    });
  }

  return points;
}

/** A trend needs at least two distinct, real cash-transaction dates. */
export function hasMeaningfulCashChartData(
  points: readonly CashHistoryPoint[],
): boolean {
  return points.length >= 2;
}
