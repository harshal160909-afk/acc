export type BusinessType =
  | "freelancer"
  | "retail"
  | "service"
  | "ecommerce"
  | "agency"
  | "manufacturing"
  | "nonprofit"
  | "personal"
  | "other";

export type LegalStructure =
  | "not_specified"
  | "sole"
  | "partnership"
  | "private";

export type ConnectionMode = "manual";

export type WorkspaceConfig = {
  ownerName: string;
  email: string;
  businessName: string;
  businessType: BusinessType;
  customBusinessType: string;
  legalStructure: LegalStructure;
  openingBankPaise: number;
  cashInHandPaise: number;
  openingCapitalPaise: number;
  connectionMode: ConnectionMode;
  financialYear: string;
  updatedAt?: number;
  setupCompletedAt?: number;
};

export type TransactionType =
  | "income"
  | "expense"
  | "capital_in"
  | "drawings"
  | "asset_purchase"
  | "liability_borrow"
  | "liability_repay"
  | "investment_purchase"
  | "bad_debt"
  | "provision_create"
  | "reserve_transfer"
  | "receivable_collection"
  | "supplier_payment"
  | "sales_return"
  | "purchase_return"
  | "customer_advance"
  | "supplier_advance"
  | "depreciation"
  | "tax_payment"
  | "reversal";

export type SettlementAccount =
  | "bank"
  | "cash"
  | "receivable"
  | "payable"
  | "not_applicable";

export type TransactionCategory =
  | "sales_revenue"
  | "service_revenue"
  | "rent_expense"
  | "supplies_expense"
  | "payroll_expense"
  | "utilities_expense"
  | "marketing_expense"
  | "other_operating_expense"
  | "owner_capital"
  | "owner_drawings"
  | "equipment_asset"
  | "furniture_asset"
  | "vehicle_asset"
  | "property_asset"
  | "inventory_asset"
  | "business_loan"
  | "other_borrowing"
  | "investment_asset"
  | "bad_debt_expense"
  | "provision_expense"
  | "general_reserve"
  | "capital_reserve"
  | "accounts_receivable"
  | "accounts_payable"
  | "sales_returns"
  | "purchase_returns"
  | "customer_advances"
  | "supplier_advances"
  | "depreciation_expense"
  | "gst_payable"
  | "tds_payable"
  | "reversal_entry";

export type JournalLine = {
  account: string;
  debitPaise: number;
  creditPaise: number;
};

export type TransactionDraft = {
  idempotencyKey: string;
  date: string;
  description: string;
  amountPaise: number;
  transactionType: TransactionType;
  category: TransactionCategory;
  settlement: SettlementAccount;
  counterparty?: string | null;
  journalLines?: JournalLine[];
  inventoryCostStatus?: "not_applicable" | "confirmed" | "pending";
  inventoryCostPaise?: number | null;
  netAmountPaise?: number;
  taxPaise?: number;
  taxRateBps?: number;
  taxAccount?: "Output GST" | "Input GST";
  quantity?: number;
  unitPricePaise?: number;
  settlementBreakdown?: Array<{ settlement: SettlementAccount; amountPaise: number }>;
  aiDraftId?: string;
  sourceType?: "manual" | "ai_approved";
};

export type PostedEntry = TransactionDraft & {
  id: string;
  entryNumber: string;
  debitAccount: string;
  creditAccount: string;
  status: "posted";
  sourceType: "manual" | "ai_approved";
  createdBy: string;
  createdAt: number;
  sourceFile: string | null;
  counterparty?: string | null;
  reversalOf?: string | null;
};

export type DataState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; message: string };

export type MetricSource =
  | "opening_balance"
  | "transaction_aggregation"
  | "journal_calculation"
  | "zero";

export type MoneyMetric = {
  amountPaise: number;
  source: MetricSource;
  sourceLabel: string;
  lastUpdatedAt?: number;
};
