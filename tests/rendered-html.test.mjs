import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appRoot = join(projectRoot, "app");

const moneyModuleUrl = pathToFileURL(join(appRoot, "lib", "money.ts")).href;

async function loadMoney() {
  return import(moneyModuleUrl);
}

async function loadFinance() {
  const [moneySource, financeSource] = await Promise.all([
    readFile(join(appRoot, "lib", "money.ts"), "utf8"),
    readFile(join(appRoot, "lib", "finance.ts"), "utf8"),
  ]);
  const options = {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  };
  const moneyJavaScript = ts.transpileModule(moneySource, options).outputText;
  const moneyDataUrl = `data:text/javascript;base64,${Buffer.from(moneyJavaScript).toString("base64")}`;
  const financeJavaScript = ts
    .transpileModule(financeSource, options)
    .outputText.replace(/from\s+["']\.\/money["']/, `from "${moneyDataUrl}"`);
  const financeDataUrl = `data:text/javascript;base64,${Buffer.from(financeJavaScript).toString("base64")}`;
  return import(financeDataUrl);
}

async function loadTransactionAssistant() {
  const [moneySource, financeSource, assistantSource] = await Promise.all([
    readFile(join(appRoot, "lib", "money.ts"), "utf8"),
    readFile(join(appRoot, "lib", "finance.ts"), "utf8"),
    readFile(join(appRoot, "lib", "ai", "transaction-assistant.ts"), "utf8"),
  ]);
  const options = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } };
  const moneyJavaScript = ts.transpileModule(moneySource, options).outputText;
  const moneyDataUrl = `data:text/javascript;base64,${Buffer.from(moneyJavaScript).toString("base64")}`;
  const financeJavaScript = ts.transpileModule(financeSource, options).outputText
    .replace(/from\s+["']\.\/money["']/, `from "${moneyDataUrl}"`);
  const financeDataUrl = `data:text/javascript;base64,${Buffer.from(financeJavaScript).toString("base64")}`;
  const assistantJavaScript = ts.transpileModule(assistantSource, options).outputText
    .replace(/from\s+["']\.\.\/finance["']/, `from "${financeDataUrl}"`);
  return import(`data:text/javascript;base64,${Buffer.from(assistantJavaScript).toString("base64")}`);
}

async function loadMarketIntelligence() {
  const source = await readFile(join(appRoot, "lib", "market-intelligence.ts"), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

function assertAcceptedMoney(result, expectedPaise) {
  assert.equal(result.valid, true, result.error ?? "Expected a valid money value");
  assert.equal(result.ok, true);
  assert.equal(result.amountPaise, expectedPaise);
  assert.equal(result.paise, expectedPaise);
}

function assertRejectedMoney(result) {
  assert.equal(result.valid, false, "Expected the money value to be rejected");
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.length > 0);
}

function configWithOpening(openingBankPaise = 0, cashInHandPaise = 0, openingCapitalPaise = 0) {
  return {
    ownerName: "Nishant",
    email: "nishant@example.com",
    businessName: "ACC Studio",
    businessType: "service",
    customBusinessType: "",
    legalStructure: "not_specified",
    openingBankPaise,
    cashInHandPaise,
    openingCapitalPaise,
    connectionMode: "manual",
    financialYear: "2026–27",
  };
}

function postedEntry(overrides = {}) {
  const transaction = {
    id: "entry-000001",
    idempotencyKey: "test-operation-000001",
    entryNumber: "JV-000001",
    date: "2026-07-15",
    description: "Invoice INV-17 paid by customer",
    amountPaise: 1_000_000,
    transactionType: "income",
    category: "sales_revenue",
    settlement: "bank",
    debitAccount: "Bank",
    creditAccount: "Sales Revenue",
    status: "posted",
    sourceType: "manual",
    createdBy: "nishant@example.com",
    createdAt: 1_752_556_800_000,
    sourceFile: null,
    ...overrides,
  };

  return transaction;
}

function amountOf(summary, key) {
  const metric = summary[key];
  assert.ok(metric, `Financial summary is missing ${key}`);
  assert.equal(typeof metric.amountPaise, "number", `${key} must expose exact paise`);
  assert.ok(Number.isSafeInteger(metric.amountPaise), `${key} must be safe integer paise`);
  assert.equal(typeof metric.sourceLabel, "string", `${key} must expose provenance`);
  assert.ok(metric.sourceLabel.length > 0, `${key} provenance cannot be blank`);
  return metric.amountPaise;
}

function assertContains(source, pattern, message) {
  if (!pattern.test(source)) assert.fail(message);
}

function assertExcludes(source, pattern, message) {
  const match = pattern.exec(source);
  if (match) assert.fail(`${message}: ${JSON.stringify(match[0])}`);
}

async function appSourceFiles(directory = appRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await appSourceFiles(absolutePath)));
    else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(entry.name))) files.push(absolutePath);
  }

  return files;
}

let workerPromise;
async function loadBuiltWorker() {
  workerPromise ??= import(
    `${pathToFileURL(join(projectRoot, "dist", "server", "index.js")).href}?acceptance=${process.pid}`
  ).then((module) => module.default);
  return workerPromise;
}

function workerEnvironment() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    DB: {
      prepare() {
        throw new Error("Database must not be touched before authentication");
      },
    },
  };
}

async function workerFetch(path, init = {}) {
  const worker = await loadBuiltWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    workerEnvironment(),
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("scenario C: exact money input preserves rupees and paise without scaling", async () => {
  const { parseMoneyInput, formatINR } = await loadMoney();

  assertAcceptedMoney(parseMoneyInput("1000"), 100_000);
  assertAcceptedMoney(parseMoneyInput("1,000"), 100_000);
  assertAcceptedMoney(parseMoneyInput("₹1,000"), 100_000);
  assertAcceptedMoney(parseMoneyInput("1000.50"), 100_050);
  assertAcceptedMoney(parseMoneyInput("₹ 1,000.50"), 100_050);
  assertAcceptedMoney(parseMoneyInput("1,00,000"), 10_000_000);

  assert.equal(formatINR(100_000), "₹1,000");
  assert.equal(formatINR(100_050), "₹1,000.50");
  assert.equal(formatINR(10_000_000), "₹1,00,000");
  assert.equal(formatINR(25_460_000), "₹2,54,600");
  assert.doesNotMatch(formatINR(25_460_000), /\b(?:K|L|Cr)\b/i);
});

test("malformed, non-finite, negative, and scientific money values are rejected", async () => {
  const { parseMoneyInput } = await loadMoney();

  for (const input of ["", "₹", "1e3", "1E3", "NaN", "Infinity", "-1000", "1,00", "1,000.5.0", "1,000.500"] ) {
    assertRejectedMoney(parseMoneyInput(input));
  }
});

test("scenario A: a new workspace is exactly zero with no invented records", async () => {
  const { calculateFinancialSummary } = await loadFinance();
  const summary = calculateFinancialSummary(configWithOpening(), []);

  assert.equal(amountOf(summary, "cashAtBank"), 0);
  assert.equal(amountOf(summary, "cashInHand"), 0);
  assert.equal(amountOf(summary, "availableCash"), 0);
  assert.equal(amountOf(summary, "revenue"), 0);
  assert.equal(amountOf(summary, "expenses"), 0);
  assert.equal(amountOf(summary, "netCashFlow"), 0);
  assert.equal(summary.profit, null);
  assert.equal(summary.hasTransactionHistory, false);
  assert.equal(summary.transactionCount, 0);
});

test("scenario B: opening ₹50,000 remains cash, never revenue or cash flow", async () => {
  const { calculateFinancialSummary, calculateTrialBalance } = await loadFinance();
  const summary = calculateFinancialSummary(configWithOpening(5_000_000), []);

  assert.equal(amountOf(summary, "cashAtBank"), 5_000_000);
  assert.equal(amountOf(summary, "cashInHand"), 0);
  assert.equal(amountOf(summary, "availableCash"), 5_000_000);
  assert.equal(amountOf(summary, "revenue"), 0);
  assert.equal(amountOf(summary, "expenses"), 0);
  assert.equal(amountOf(summary, "netCashFlow"), 0);
  assert.equal(summary.profit, null);
  assert.equal(summary.hasTransactionHistory, false);
  assert.deepEqual(calculateTrialBalance([]).rows, []);
});

test("scenario D: a ₹10,000 cash sale changes cash and revenue by exactly ₹10,000", async () => {
  const { calculateFinancialSummary } = await loadFinance();
  const sale = postedEntry({
    settlement: "cash",
    debitAccount: "Cash in Hand",
    amountPaise: 1_000_000,
  });
  const summary = calculateFinancialSummary(configWithOpening(5_000_000), [sale]);

  assert.equal(amountOf(summary, "cashAtBank"), 5_000_000);
  assert.equal(amountOf(summary, "cashInHand"), 1_000_000);
  assert.equal(amountOf(summary, "availableCash"), 6_000_000);
  assert.equal(amountOf(summary, "revenue"), 1_000_000);
  assert.equal(amountOf(summary, "expenses"), 0);
  assert.equal(amountOf(summary, "netCashFlow"), 1_000_000);
  assert.equal(summary.profit?.amountPaise, 1_000_000);
  assert.equal(summary.hasTransactionHistory, true);
});

test("scenario E: a ₹5,000 bank expense reduces available cash exactly once", async () => {
  const { calculateFinancialSummary } = await loadFinance();
  const expense = postedEntry({
    id: "entry-000002",
    entryNumber: "JV-000002",
    description: "July office rent paid from bank",
    amountPaise: 500_000,
    transactionType: "expense",
    category: "rent_expense",
    settlement: "bank",
    debitAccount: "Rent Expense",
    creditAccount: "Bank",
  });
  const summary = calculateFinancialSummary(configWithOpening(5_000_000), [expense]);

  assert.equal(amountOf(summary, "cashAtBank"), 4_500_000);
  assert.equal(amountOf(summary, "availableCash"), 4_500_000);
  assert.equal(amountOf(summary, "revenue"), 0);
  assert.equal(amountOf(summary, "expenses"), 500_000);
  assert.equal(amountOf(summary, "netCashFlow"), -500_000);
  assert.equal(summary.profit?.amountPaise, -500_000);
});

test("journal derivation is double-entry balanced and the ledger retains its source", async () => {
  const { calculateLedger, calculateTrialBalance, deriveJournalLines } = await loadFinance();
  const source = postedEntry();
  const lines = deriveJournalLines(source);

  assert.equal(lines.length, 2);
  assert.equal(
    lines.reduce((total, line) => total + line.debitPaise, 0),
    lines.reduce((total, line) => total + line.creditPaise, 0),
  );
  assert.equal(lines.reduce((total, line) => total + line.debitPaise, 0), source.amountPaise);
  assert.ok(lines.every((line) => line.account.length > 0));
  assert.equal(source.description, "Invoice INV-17 paid by customer");
  assert.equal(source.sourceType, "manual");

  const trialBalance = calculateTrialBalance([source]);
  assert.equal(trialBalance.isBalanced, true);
  assert.equal(trialBalance.totalDebitsPaise, source.amountPaise);
  assert.equal(trialBalance.totalCreditsPaise, source.amountPaise);

  const ledger = calculateLedger([source], "Bank");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].entryId, source.id);
  assert.equal(ledger[0].entryNumber, source.entryNumber);
  assert.equal(ledger[0].description, source.description);
});

test("credit sales and unpaid expenses keep the same account names from API to books", async () => {
  const [finance, apiSource] = await Promise.all([
    loadFinance(),
    readFile(join(appRoot, "api", "entries", "route.ts"), "utf8"),
  ]);
  const { calculateAccountBalances, calculateFinancialSummary, deriveJournalLines } = finance;
  const creditSale = postedEntry({
    id: "entry-000003",
    entryNumber: "JV-000003",
    description: "Customer invoice awaiting payment",
    settlement: "receivable",
    debitAccount: "Accounts Receivable",
  });
  const unpaidExpense = postedEntry({
    id: "entry-000004",
    entryNumber: "JV-000004",
    description: "Supplier bill awaiting payment",
    amountPaise: 250_000,
    transactionType: "expense",
    category: "supplies_expense",
    settlement: "payable",
    debitAccount: "Supplies Expense",
    creditAccount: "Accounts Payable",
  });

  assert.equal(deriveJournalLines(creditSale)[0].account, "Accounts Receivable");
  assert.equal(deriveJournalLines(unpaidExpense)[1].account, "Accounts Payable");
  assert.equal(amountOf(calculateFinancialSummary(configWithOpening(), [creditSale, unpaidExpense]), "receivables"), 1_000_000);
  assert.equal(amountOf(calculateFinancialSummary(configWithOpening(), [creditSale, unpaidExpense]), "payables"), 250_000);
  assert.ok(calculateAccountBalances(configWithOpening(), [creditSale, unpaidExpense]).accounts.some((row) => row.account === "Accounts Receivable"));
  assert.ok(calculateAccountBalances(configWithOpening(), [creditSale, unpaidExpense]).accounts.some((row) => row.account === "Accounts Payable"));
  assert.match(apiSource, /"Accounts Receivable"/);
  assert.match(apiSource, /"Accounts Payable"/);
  assert.doesNotMatch(apiSource, /"Trade Receivables"|"Trade Payables"/);
});

test("capital, assets, liabilities, drawings, investments, bad debts, provisions and reserves stay in the correct statements", async () => {
  const { calculateFinancialSummary, calculateAccountBalances } = await loadFinance();
  const config = configWithOpening(100_000, 0, 100_000);
  const cases = [
    ["capital", "capital_in", "owner_capital", "bank", "Bank", "Owner's Capital", 50_000],
    ["asset", "asset_purchase", "equipment_asset", "bank", "Equipment", "Bank", 20_000],
    ["loan", "liability_borrow", "business_loan", "bank", "Bank", "Business Loan", 30_000],
    ["repay", "liability_repay", "business_loan", "bank", "Business Loan", "Bank", 10_000],
    ["investment", "investment_purchase", "investment_asset", "bank", "Investments", "Bank", 5_000],
    ["credit-sale", "income", "sales_revenue", "receivable", "Accounts Receivable", "Sales Revenue", 10_000],
    ["bad-debt", "bad_debt", "bad_debt_expense", "receivable", "Bad Debts Expense", "Accounts Receivable", 10_000],
    ["provision", "provision_create", "provision_expense", "not_applicable", "Provision Expense", "Provision for Expenses", 2_500],
    ["reserve", "reserve_transfer", "general_reserve", "not_applicable", "Retained Earnings", "General Reserve", 1_000],
    ["drawings", "drawings", "owner_drawings", "bank", "Drawings", "Bank", 5_000],
  ];
  const entries = cases.map(([id, transactionType, category, settlement, debitAccount, creditAccount, amountPaise], index) => postedEntry({
    id: `entry-${id}`,
    idempotencyKey: `test-operation-${String(index + 10).padStart(6, "0")}`,
    entryNumber: `JV-${String(index + 10).padStart(6, "0")}`,
    description: `Verified ${id}`,
    transactionType,
    category,
    settlement,
    debitAccount,
    creditAccount,
    amountPaise,
    createdAt: 1_752_556_800_000 + index,
  }));
  const summary = calculateFinancialSummary(config, entries);
  assert.equal(summary.availableCash.amountPaise, 140_000);
  assert.equal(summary.revenue.amountPaise, 10_000);
  assert.equal(summary.expenses.amountPaise, 12_500);
  assert.equal(summary.profit.amountPaise, -2_500);
  assert.equal(summary.totalAssetsPaise, 165_000);
  assert.equal(summary.totalLiabilitiesPaise, 22_500);
  assert.equal(summary.equityPaise, 142_500);
  assert.equal(summary.balanceSheetReady, true);
  const balances = calculateAccountBalances(config, entries).accounts;
  const balance = (account) => balances.find((row) => row.account === account)?.balancePaise;
  assert.equal(balance("Equipment"), 20_000);
  assert.equal(balance("Investments"), 5_000);
  assert.equal(balance("Business Loan"), 20_000);
  assert.equal(balance("Accounts Receivable"), 0);
  assert.equal(balance("Provision for Expenses"), 2_500);
  assert.equal(balance("General Reserve"), 1_000);
  assert.equal(balance("Drawings"), -5_000);
});

test("Indian-language transaction extraction preserves lakh, crore, quantity, GST, cheque and mixed settlement arithmetic", async () => {
  const { continueTransactionConversation, parseIndianAmountPaise } = await loadTransactionAssistant();
  assert.deepEqual(parseIndianAmountPaise("Owner introduced ₹1.2 lakh"), [12_000_000]);
  assert.deepEqual(parseIndianAmountPaise("Loan received ₹2 crore"), [2_000_000_000]);

  const cheque = continueTransactionConversation("Sold clothes 10 shirts at ₹500 each and received a cheque today");
  assert.equal(cheque.kind, "clarification");
  assert.equal(cheque.pending.amountPaise, 500_000);
  assert.equal(cheque.pending.quantity, 10);
  assert.equal(cheque.pending.unitPricePaise, 50_000);
  assert.equal(cheque.pending.settlement, "bank");
  const chequeProposal = continueTransactionConversation("cost pending", cheque.pending);
  assert.equal(chequeProposal.kind, "proposal");
  assert.equal(chequeProposal.draft.inventoryCostStatus, "pending");

  const gst = continueTransactionConversation("Provided consulting service for ₹50,000 plus 18% GST by UPI today");
  assert.equal(gst.kind, "proposal");
  assert.equal(gst.draft.netAmountPaise, 5_000_000);
  assert.equal(gst.draft.taxPaise, 900_000);
  assert.equal(gst.draft.amountPaise, 5_900_000);
  assert.deepEqual(gst.journalLines, [
    { account: "Bank", debitPaise: 5_900_000, creditPaise: 0 },
    { account: "Service Revenue", debitPaise: 0, creditPaise: 5_000_000 },
    { account: "Output GST", debitPaise: 0, creditPaise: 900_000 },
  ]);

  const mixed = continueTransactionConversation("Bought machinery for ₹1.2 lakh, paid ₹20,000 cash and rest on credit today");
  assert.equal(mixed.kind, "proposal");
  assert.equal(mixed.draft.amountPaise, 12_000_000);
  assert.deepEqual(mixed.draft.settlementBreakdown, [
    { settlement: "cash", amountPaise: 2_000_000 },
    { settlement: "payable", amountPaise: 10_000_000 },
  ]);
  assert.equal(mixed.journalLines.reduce((sum, line) => sum + line.debitPaise, 0), 12_000_000);
  assert.equal(mixed.journalLines.reduce((sum, line) => sum + line.creditPaise, 0), 12_000_000);
});

test("collections, supplier payments, returns and reversals use safe accounting flows", async () => {
  const { continueTransactionConversation } = await loadTransactionAssistant();
  const collection = continueTransactionConversation("Customer paid previous invoice ₹10,000 by UPI today");
  assert.equal(collection.kind, "proposal");
  assert.equal(collection.draft.transactionType, "receivable_collection");
  assert.deepEqual(collection.journalLines, [
    { account: "Bank", debitPaise: 1_000_000, creditPaise: 0 },
    { account: "Accounts Receivable", debitPaise: 0, creditPaise: 1_000_000 },
  ]);

  const supplier = continueTransactionConversation("Paid supplier against amount due ₹7,500 through NEFT today");
  assert.equal(supplier.kind, "proposal");
  assert.equal(supplier.draft.transactionType, "supplier_payment");
  assert.deepEqual(supplier.journalLines, [
    { account: "Accounts Payable", debitPaise: 750_000, creditPaise: 0 },
    { account: "Bank", debitPaise: 0, creditPaise: 750_000 },
  ]);

  const returned = continueTransactionConversation("Sales return ₹5,000 refunded to customer by bank today");
  assert.equal(returned.kind, "proposal");
  assert.equal(returned.draft.transactionType, "sales_return");
  assert.equal(returned.journalLines.reduce((sum, line) => sum + line.debitPaise, 0), 500_000);
  assert.equal(returned.journalLines.reduce((sum, line) => sum + line.creditPaise, 0), 500_000);

  const reversal = continueTransactionConversation("Reverse the duplicate entry");
  assert.equal(reversal.kind, "clarification");
  assert.equal(reversal.missingField, "originalEntryId");
  assert.match(reversal.question, /open Books.*Reverse/i);
});

test("GST, advances, depreciation and returns land in the correct balance-sheet and profit accounts", async () => {
  const { calculateFinancialSummary, calculateAccountBalances } = await loadFinance();
  const gstSale = postedEntry({
    id: "entry-gst-sale", entryNumber: "JV-GST-1", amountPaise: 5_900_000,
    netAmountPaise: 5_000_000, taxPaise: 900_000, taxRateBps: 1800, taxAccount: "Output GST",
    transactionType: "income", category: "service_revenue", settlement: "bank",
    debitAccount: "Bank", creditAccount: "Service Revenue",
  });
  const salesReturn = postedEntry({
    id: "entry-return", entryNumber: "JV-RET-1", amountPaise: 500_000,
    transactionType: "sales_return", category: "sales_returns", settlement: "bank",
    debitAccount: "Sales Returns", creditAccount: "Bank",
  });
  const depreciation = postedEntry({
    id: "entry-dep", entryNumber: "JV-DEP-1", amountPaise: 100_000,
    transactionType: "depreciation", category: "depreciation_expense", settlement: "not_applicable",
    debitAccount: "Depreciation Expense", creditAccount: "Accumulated Depreciation",
  });
  const summary = calculateFinancialSummary(configWithOpening(), [gstSale, salesReturn, depreciation]);
  assert.equal(summary.revenue.amountPaise, 4_500_000);
  assert.equal(summary.expenses.amountPaise, 100_000);
  assert.equal(summary.profit.amountPaise, 4_400_000);
  assert.equal(summary.totalAssetsPaise, 5_300_000);
  assert.equal(summary.totalLiabilitiesPaise, 900_000);
  assert.equal(summary.equityPaise, 4_400_000);
  assert.equal(summary.balanceSheetReady, true);
  const accounts = calculateAccountBalances(configWithOpening(), [gstSale, salesReturn, depreciation]).accounts;
  const byName = (name) => accounts.find((row) => row.account === name);
  assert.equal(byName("Output GST")?.accountType, "liability");
  assert.equal(byName("Output GST")?.balancePaise, 900_000);
  assert.equal(byName("Accumulated Depreciation")?.accountType, "asset");
  assert.equal(byName("Accumulated Depreciation")?.balancePaise, -100_000);
  assert.equal(byName("Sales Returns")?.balancePaise, -500_000);
});

test("combined opening balances cannot exceed the exact paise range", async () => {
  const { calculateFinancialSummary } = await loadFinance();
  assert.throws(
    () => calculateFinancialSummary(configWithOpening(Number.MAX_SAFE_INTEGER, 1), []),
    /safe paise range/i,
  );

  const [profileApi, onboarding] = await Promise.all([
    readFile(join(appRoot, "api", "profile", "route.ts"), "utf8"),
    readFile(join(appRoot, "components", "OnboardingFlow.tsx"), "utf8"),
  ]);
  assertContains(profileApi, /Number\.isSafeInteger\(openingTotalPaise\)/, "Profile storage must reject an unsafe combined opening balance");
  assertContains(onboarding, /openingTotalPaise === null/, "Onboarding must stop before formatting or saving an unsafe opening total");
});

test("posting is idempotent and opening balances lock after the first post", async () => {
  const [entryApi, profileApi, workspace, schema] = await Promise.all([
    readFile(join(appRoot, "api", "entries", "route.ts"), "utf8"),
    readFile(join(appRoot, "api", "profile", "route.ts"), "utf8"),
    readFile(join(appRoot, "components", "Workspace.tsx"), "utf8"),
    readFile(join(projectRoot, "db", "schema.ts"), "utf8"),
  ]);

  assertContains(workspace, /useState\(\(\) => crypto\.randomUUID\(\)\)[\s\S]*idempotencyKey, date/, "A review retry needs one stable posting operation key");
  assertContains(entryApi, /idempotentEntrySelect[\s\S]*Idempotency-Replayed/, "The API must read back an earlier successful retry");
  assertContains(schema, /uniqueIndex\("accounting_entries_owner_idempotency_idx"\)/, "Storage must enforce one owner operation key");
  assertContains(profileApi, /Opening balances are locked after the first posted entry/, "Opening balances must not rewrite posted history");
  assertContains(workspace, /Opening money is locked after your first entry/, "The accounts UI must explain the opening-balance lock in plain language");
});

test("the visible overview period is the same period used for calculations", async () => {
  const workspace = await readFile(join(appRoot, "components", "Workspace.tsx"), "utf8");
  assertContains(workspace, /YOUR BUSINESS · \{periodLabel\}/, "Overview must label the current calculated period");
  assertExcludes(workspace, /YOUR BUSINESS · \{config\.financialYear\}/, "Persisted setup text must not label a different calculation period");
});

test("scenario G: cash chart data contains only real transaction dates", async () => {
  const { buildCashHistoryData, hasMeaningfulCashChartData } = await loadFinance();
  const config = configWithOpening(5_000_000);

  const empty = buildCashHistoryData(config, []);
  assert.deepEqual(empty, []);
  assert.equal(hasMeaningfulCashChartData(empty), false);

  const oneRealDate = buildCashHistoryData(config, [postedEntry()]);
  assert.equal(oneRealDate.length, 1);
  assert.equal(oneRealDate[0].date, "2026-07-15");
  assert.equal(oneRealDate[0].transactionCount, 1);
  assert.equal(hasMeaningfulCashChartData(oneRealDate), false);

  const twoRealDates = buildCashHistoryData(config, [
    postedEntry(),
    postedEntry({
      id: "entry-000002",
      entryNumber: "JV-000002",
      date: "2026-07-16",
      description: "Second customer payment",
    }),
  ]);
  assert.deepEqual(twoRealDates.map((point) => point.date), ["2026-07-15", "2026-07-16"]);
  assert.equal(hasMeaningfulCashChartData(twoRealDates), true);
});

test("money map reconciles opening cash plus real inflows minus real outflows", async () => {
  const { buildCashBridge } = await loadFinance();
  const income = postedEntry();
  const expense = postedEntry({
    id: "entry-000002",
    entryNumber: "JV-000002",
    date: "2026-07-16",
    description: "Office rent paid from bank",
    amountPaise: 500_000,
    transactionType: "expense",
    category: "rent_expense",
    debitAccount: "Rent Expense",
    creditAccount: "Bank",
  });

  const bridge = buildCashBridge(configWithOpening(5_000_000), [income, expense]);
  assert.deepEqual(bridge, {
    openingCashPaise: 5_000_000,
    cashInflowsPaise: 1_000_000,
    cashOutflowsPaise: 500_000,
    netCashFlowPaise: 500_000,
    closingCashPaise: 5_500_000,
    transactionCount: 2,
    period: { startDate: "2026-07-15", endDate: "2026-07-16" },
  });
});

test("scenario F and G: loading, failure, and empty-history states remain distinct", async () => {
  const [accApp, workspace, types] = await Promise.all([
    readFile(join(appRoot, "components", "AccApp.tsx"), "utf8"),
    readFile(join(appRoot, "components", "Workspace.tsx"), "utf8"),
    readFile(join(appRoot, "components", "types.ts"), "utf8"),
  ]);

  assertContains(types, /status:\s*"loading"/, "DataState must distinguish loading");
  assertContains(types, /status:\s*"success"/, "DataState must distinguish success");
  assertContains(types, /status:\s*"error"/, "DataState must distinguish errors");
  assertContains(accApp, /bootstrap\.status === "loading"\) return/, "ACC must render loading separately");
  assertContains(accApp, /bootstrap\.status === "error"\) return/, "ACC must render load errors separately");
  assertContains(accApp + workspace, /Unable to load (?:data|your workspace)/i, "The load-error state needs clear copy");
  assertContains(accApp, /message=\{bootstrap\.message\}/i, "Load failure must show the actual error instead of a financial value");
  assertContains(workspace, /No money has moved through ACC yet/i, "The empty chart state needs honest copy");
  assertContains(workspace, /entry\.description/, "Posted sources must remain inspectable");
  assertContains(workspace, /(?:View|Inspect|Open) source|Source details|What happened/i, "The UI needs a source-inspection action");
  assertExcludes(workspace, /cashPath|shortMoney|function\s+(?:parseAmount|accountingFor|openingEntries)\b|invented lines|invented bars/i, "Legacy fabricated or coercive finance logic remains");
});

test("onboarding asks one sourced question at a time and never requires yearly revenue", async () => {
  const onboarding = await readFile(join(appRoot, "components", "OnboardingFlow.tsx"), "utf8");

  assertContains(onboarding, /const totalSteps = 9/, "Onboarding must keep the focused nine-step sequence");
  for (let step = 0; step < 9; step += 1) {
    assertContains(onboarding, new RegExp(`step === ${step}`), `Onboarding step ${step + 1} is missing`);
  }
  assertContains(onboarding, /Cash at bank/, "Onboarding must ask for optional opening bank cash");
  assertContains(onboarding, /Cash in hand/, "Onboarding must keep cash in hand separate");
  assertContains(onboarding, /opening capital/i, "Onboarding must ask for the source of opening money");
  assertContains(onboarding, /Everything ACC knows|Review your workspace/, "Onboarding needs a source-value review");
  assertContains(onboarding, /Signed in[\s\S]{0,120}user\.email/, "Authenticated identity must be shown read-only");
  assertExcludes(onboarding, /annualRevenue|yearly revenue|Google account email|type="email"/i, "Onboarding still asks for an invented or duplicate identity/revenue input");
});

test("the ACC visual system keeps the reference-led editorial palette, solid reports, accessible focus, and restrained glass", async () => {
  const css = await readFile(join(appRoot, "acc.css"), "utf8");

  for (const token of ["#e2a8ca", "#f7f0f5", "#2b292d", "#fffdfc", "#8f4967", "#3f7567", "#76506f", "#b8aaa1", "#efd6e7", "#afcdf4", "#b5d8cc", "#c8acd4"]) {
    assertContains(css, new RegExp(token, "i"), `Required editorial colour ${token} is missing`);
  }

  assertContains(css, /\.cash-cockpit\s*\{[^}]*background:\s*var\(--powder\)/is, "The main financial cockpit must use the powder-blue editorial surface");
  assertContains(css, /\.metric-grid\s+\.metric-card:nth-child\(4n \+ 1\)\s*\{[^}]*background:\s*rgba\(175,205,244/is, "Metric cards must start with the powder-blue accent");
  assertContains(css, /\.metric-grid\s+\.metric-card:nth-child\(4n \+ 2\)\s*\{[^}]*background:\s*rgba\(239,214,231/is, "Metric cards must include the blush accent");
  assertContains(css, /\.metric-grid\s+\.metric-card:nth-child\(4n \+ 3\)\s*\{[^}]*background:\s*rgba\(181,216,204/is, "Metric cards must include the mint accent");
  assertContains(css, /\.metric-grid\s+\.metric-card:nth-child\(4n \+ 4\)\s*\{[^}]*background:\s*rgba\(200,172,212/is, "Metric cards must include the lilac accent");
  assertContains(css, /\.market-hero\s*\{[^}]*background:\s*linear-gradient\([^}]*var\(--blush\)[^}]*rgba\(175,205,244/is, "Market Intelligence must share the blush-and-powder editorial identity");

  const reportPaperRules = css.match(/\.report-paper\s*\{[^}]*\}/gi) ?? [];
  assert.ok(reportPaperRules.some((rule) => /background:\s*var\(--paper\)/i.test(rule)), "Accounting reports must use a solid paper background");
  assertExcludes(reportPaperRules.join("\n"), /backdrop-filter/i, "Accounting reports must remain solid and must not become glass");
  assertContains(css, /\.report-paper\s+\.financial-table\s+thead[^\{]*\{[^}]*background:\s*var\(--charcoal\)/is, "Financial table headings need a high-contrast solid surface");

  assertContains(css, /\.glass-bar\s*\{[^}]*backdrop-filter:\s*blur\((?:18|20|22|24)px\)\s+saturate\(115%\)/is, "Floating navigation must retain real glass blur");
  assertContains(css, /\.glass-modal\s*\{[^}]*backdrop-filter:\s*blur\((?:18|20|22|24)px\)\s+saturate\(115%\)/is, "Glass dialogs must retain real glass blur");
  assertContains(css, /\.modal-backdrop[^\{]*\{[^}]*backdrop-filter:\s*blur\(18px\)\s+saturate\(105%\)/is, "Dialog backdrops must blur the workspace beneath them");
  assertContains(css, /font-variant-numeric:\s*tabular-nums/i, "Financial values need aligned numerals");
  assertContains(css, /:focus-visible/, "Keyboard focus styles are missing");
  assertContains(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i, "Reduced-motion support is missing");
  assertContains(css, /@media\s*\(max-width:\s*680px\)/i, "The mobile layout breakpoint is missing");
  assertContains(css, /onboarding-shell\.is-focused[\s\S]*filter:\s*blur\(7px\)/i, "Focused setup inputs must blur and recede the surrounding screen");
});

test("ACC navigation, persistent Ask ACC, approval-only posting, Pulse, Investments, and Settings are wired", async () => {
  const [workspace, aiRoute, entriesRoute, investmentsRoute, schema] = await Promise.all([
    readFile(join(appRoot, "components", "Workspace.tsx"), "utf8"),
    readFile(join(appRoot, "api", "ai", "route.ts"), "utf8"),
    readFile(join(appRoot, "api", "entries", "route.ts"), "utf8"),
    readFile(join(appRoot, "api", "investments", "route.ts"), "utf8"),
    readFile(join(projectRoot, "db", "schema.ts"), "utf8"),
  ]);
  for (const label of ["Overview", "ACC Pulse", "Books", "Accounts", "Investments · Beta", "Market Research · Beta", "Ask ACC", "Settings"]) {
    assertContains(workspace, new RegExp(`label: "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `Navigation is missing ${label}`);
  }
  assertContains(aiRoute, /INSERT INTO ai_messages/, "Ask ACC messages must persist");
  assertContains(aiRoute, /text\/event-stream/, "Ask ACC must stream responses");
  assertContains(aiRoute, /INSERT INTO ai_drafts/, "AI transaction proposals must persist as drafts");
  assertExcludes(aiRoute, /INSERT INTO accounting_entries/, "Ask ACC must not post directly into accounting entries");
  assertContains(entriesRoute, /postApprovedAiDraft/, "The posting endpoint needs an explicit AI approval path");
  assertContains(entriesRoute, /parseJournalLines[\s\S]*debit === credit/, "AI approvals must recheck the balanced journal server-side");
  assertContains(investmentsRoute, /user_manual/, "Manual investment prices need explicit provenance");
  for (const table of ["ai_threads", "ai_messages", "ai_tool_calls", "ai_drafts", "audit_events", "portfolios", "investment_transactions", "price_snapshots"]) {
    assertContains(schema, new RegExp(`sqliteTable\\("${table}"`), `Schema is missing ${table}`);
  }
});

test("Market Intelligence cleaning preserves provenance and does not confuse duplicates or promotion with demand", async () => {
  const { cleanMarketSignals } = await loadMarketIntelligence();
  const base = {
    provider: "reddit",
    sourceType: "public_discussion",
    publicUrl: "https://www.reddit.com/r/example/comments/public-record",
    publishedAt: Date.parse("2026-06-01T00:00:00Z"),
    retrievedAt: Date.parse("2026-07-16T00:00:00Z"),
    geography: null,
    engagement: { score: 4 },
  };
  const raw = [
    { ...base, externalId: "one", title: "Electrolyte option", excerpt: "I am looking for a better alternative that is easier to carry." },
    { ...base, externalId: "two", publicUrl: "https://www.reddit.com/r/example/comments/repost", title: "Electrolyte option", excerpt: "I am looking for a better alternative that is easier to carry." },
    { ...base, externalId: "three", publicUrl: "https://www.youtube.com/watch?v=public", provider: "youtube", sourceType: "public_video_comment", title: "Electrolyte offer", excerpt: "Sponsored: use my discount code and buy now." },
    { ...base, externalId: "four", publicUrl: "https://www.youtube.com/watch?v=evidence", provider: "youtube", sourceType: "public_video_comment", title: "Electrolyte sachet", excerpt: "Where can I buy a smaller travel-friendly format?" },
  ];
  const result = cleanMarketSignals(raw, ["electrolyte"]);

  assert.equal(result.metrics.rawItemsCollected, 4);
  assert.equal(result.metrics.duplicatesRemoved, 1);
  assert.equal(result.metrics.promotionalItemsFiltered, 1);
  assert.equal(result.metrics.relevantItemsRetained, 2);
  assert.deepEqual(result.metrics.sourcesRepresented, ["reddit", "youtube"]);
  assert.equal(result.signals[0].publicUrl, raw[0].publicUrl);
  assert.equal(result.signals[0].provider, "reddit");
  assert.equal(result.signals[1].duplicate, true);
  assert.equal(result.signals[2].promotional, true);
});

test("Market Intelligence holds momentum when cross-source evidence is insufficient", async () => {
  const { cleanMarketSignals, buildProblemClusters } = await loadMarketIntelligence();
  const time = Date.parse("2026-07-01T00:00:00Z");
  const raw = Array.from({ length: 4 }, (_, index) => ({
    provider: "reddit",
    externalId: `single-${index}`,
    publicUrl: `https://www.reddit.com/r/example/comments/single-${index}`,
    sourceType: "public_discussion",
    title: `Alternative request ${index}`,
    excerpt: `I am looking for a better alternative to this product number ${index}.`,
    publishedAt: time + index * 86_400_000,
    retrievedAt: time + 10 * 86_400_000,
  }));
  const { signals } = cleanMarketSignals(raw, ["product"]);
  const cluster = buildProblemClusters(signals).find((item) => item.key === "alternative_seeking");

  assert.ok(cluster);
  assert.equal(cluster.classification, "Insufficient evidence");
  assert.equal(cluster.momentumPercent, null);
  assert.equal(cluster.confidence, "low");
  assert.match(cluster.classificationReason, /five relevant items|two independent source types/i);
});

test("Market Intelligence scores are transparent, gated, fixed-version calculations", async () => {
  const { calculateTransparentOpportunityScore, MARKET_SCORE_WEIGHTS, MARKET_METHODOLOGY_VERSION } = await loadMarketIntelligence();
  const inputs = {
    relevantItems: 18,
    independentSources: 3,
    averageSourceQuality: 72,
    recentItemShare: 0.7,
    geographicItemShare: 0.6,
    momentumPercent: 35,
    durationDays: 42,
    recurrenceShare: 0.6,
    painSeverity: 70,
    purchaseIntentShare: 0.3,
    alternativeSeekingShare: 0.5,
    dissatisfactionShare: 0.6,
    competitorCount: 4,
    competitorMomentum: 25,
    conflictingEvidenceShare: 0.2,
    promotionalShare: 0.1,
    missingSourceCount: 1,
    geographyVerified: true,
    seasonalAmbiguity: false,
  };
  const held = calculateTransparentOpportunityScore(inputs);
  assert.equal(held.combined, null);
  assert.match(held.combinedUnavailableReason, /Books permission|execution inputs/i);

  const scored = calculateTransparentOpportunityScore({ ...inputs, businessFitSignals: [70, 80], executionSignals: [60, 75] });
  assert.equal(scored.methodologyVersion, MARKET_METHODOLOGY_VERSION);
  assert.deepEqual(scored.weights, MARKET_SCORE_WEIGHTS);
  assert.ok(Number.isInteger(scored.combined) && scored.combined >= 0 && scored.combined <= 100);
  for (const [name, value] of Object.entries(scored.components)) {
    assert.ok(value === null || (Number.isInteger(value) && value >= 0 && value <= 100), `${name} must be an inspectable 0–100 component`);
  }
});

test("forecasting stays disabled until history, coverage, stability, missing-data, and backtesting gates all pass", async () => {
  const { forecastingGate } = await loadMarketIntelligence();
  const early = forecastingGate({ durationDays: 30, independentSources: 2, relevantItems: 40, stableRuns: 3, missingDataShare: 0.2, backtestReady: false });
  assert.equal(early.enabled, false);
  assert.equal(early.requirements.every((item) => item.met), false);
  const mature = forecastingGate({ durationDays: 120, independentSources: 4, relevantItems: 180, stableRuns: 10, missingDataShare: 0.05, backtestReady: true });
  assert.equal(mature.enabled, true);
});

test("ground-truth evaluation compares estimates with actual validation results by opportunity", async () => {
  const { calculateExperimentEvaluation } = await loadMarketIntelligence();
  const result = calculateExperimentEvaluation([
    { opportunityId: "opportunity-a", status: "launched", decision: "launched", startDate: "2026-07-01", endDate: "2026-07-11", estimatedResponseRateBps: 3000, customersContacted: 20, responses: 8 },
    { opportunityId: "opportunity-a", status: "result_recorded", decision: null, startDate: "2026-07-12", endDate: "2026-07-17", estimatedResponseRateBps: 2500, customersContacted: 10, responses: 2 },
    { opportunityId: "opportunity-b", status: "rejected", decision: "rejected", startDate: "2026-07-01", endDate: "2026-07-16", estimatedResponseRateBps: 4000, customersContacted: 20, responses: 1 },
  ]);
  assert.equal(result.opportunitiesTested, 2);
  assert.equal(result.positiveExperiments, 1);
  assert.equal(result.falsePositiveSignals, 1);
  assert.equal(result.averageValidationDays, 10);
  assert.equal(result.averageEstimatedResponseRateBps, 3167);
  assert.equal(result.averageActualResponseRateBps, 2167);
});

test("the complete Market Intelligence product surface, evidence boundaries, and durable records are wired", async () => {
  const [view, route, connectors, schema, css] = await Promise.all([
    readFile(join(appRoot, "components", "MarketIntelligenceView.tsx"), "utf8"),
    readFile(join(appRoot, "api", "market-intelligence", "route.ts"), "utf8"),
    readFile(join(appRoot, "lib", "market-intelligence", "connectors.ts"), "utf8"),
    readFile(join(projectRoot, "db", "schema.ts"), "utf8"),
    readFile(join(appRoot, "acc.css"), "utf8"),
  ]);
  for (const label of ["Market Overview", "Opportunity Feed", "Customer Problems", "Demand Signals", "Competitors", "Case Studies", "Saved Opportunities", "Experiments", "Alerts", "Methodology & Sources"]) {
    assertContains(view, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Market Intelligence is missing ${label}`);
  }
  assertContains(view, /Your market\.[\s\S]*In motion\./, "The market hero is missing");
  assertContains(view, /Inspect evidence/i, "Opportunities must expose their evidence");
  assertContains(view, /EXTERNAL MARKET EVIDENCE[\s\S]*INTERNAL BUSINESS FIT[\s\S]*HUMAN DECISION/, "External evidence, internal fit, and human decision are not separated");
  assertContains(view, /No market sources are configured yet|Not enough evidence to calculate momentum/, "Honest empty states are missing");
  assertContains(view, /No private messages, private accounts, closed communities/, "Privacy boundaries must be visible");
  assertContains(route, /previous_report_preserved/, "A failed run must preserve the earlier report");
  assertContains(route, /async function runResearch[\s\S]*cleanMarketSignals[\s\S]*buildProblemClusters/, "The collection and cleaning pipeline is incomplete");
  assertContains(route, /action === "run_research"[\s\S]*runResearch\(/, "The research action is not wired to the collection pipeline");
  assertContains(connectors, /oauth\.reddit\.com|youtube\/v3/, "Official provider adapters are missing");
  assertContains(connectors, /REDDIT_COMMERCIAL_APPROVAL[\s\S]*YOUTUBE_COMPLIANCE_APPROVED/, "Connector compliance gates are missing");
  assertExcludes(connectors, /puppeteer|playwright|cheerio|scrap(?:e|ing)/i, "Source adapters must not scrape providers");
  assertContains(css, /\.evidence-machine[\s\S]*perspective:/, "The connected 3D evidence instrument is missing");
  for (const table of ["market_profiles", "market_sources", "market_collection_runs", "market_signals", "market_cleaning_runs", "market_problem_clusters", "market_opportunities", "market_opportunity_events", "market_experiments", "market_competitor_insights", "market_alerts"]) {
    assertContains(schema, new RegExp(`sqliteTable\\("${table}"`), `Schema is missing ${table}`);
  }
});

test("investment quantities and values remain decimal-safe", async () => {
  const source = await readFile(join(appRoot, "lib", "investments.ts"), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const investmentsModule = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
  assert.equal(investmentsModule.parseQuantityMicros("10"), 10_000_000);
  assert.equal(investmentsModule.parseQuantityMicros("0.125"), 125_000);
  assert.equal(investmentsModule.parseQuantityMicros("1.1234567"), null);
  assert.equal(investmentsModule.multiplyPriceByQuantity(245_050, 10_000_000), 2_450_500);
  assert.equal(investmentsModule.formatQuantityMicros(125_000), "0.125");
});

test("the overview feels simple while its connected visualization stays data-backed", async () => {
  const [workspace, financialUi] = await Promise.all([
    readFile(join(appRoot, "components", "Workspace.tsx"), "utf8"),
    readFile(join(appRoot, "components", "FinancialUI.tsx"), "utf8"),
  ]);

  assertContains(workspace, /className="money-map"/, "The connected money map is missing");
  assertContains(workspace, /canSplitCash[\s\S]*bankAngle/, "The cash donut must be derived from real bank and cash balances");
  assertContains(workspace, /available === 0[\s\S]*Ready when/, "A new workspace should use a calm empty state instead of a zero headline");
  assertContains(workspace, /onClick=\{\(\) => onBooks\("profit"\)\}/, "Money movement nodes must open the relevant report");
  assertContains(workspace, /onClick=\{onAccounts\}/, "Account nodes must open the Accounts section");
  assertExcludes(financialUi, /metric\.sourceLabel/, "Customer-facing metric cards must not expose provenance labels");
});

test("profile and entry APIs reject every unauthenticated read and write before storage", async () => {
  const requests = [
    ["/api/profile", { method: "GET" }],
    ["/api/entries", { method: "GET" }],
    ["/api/ai", { method: "GET" }],
    ["/api/investments", { method: "GET" }],
    ["/api/market-intelligence", { method: "GET" }],
    [
      "/api/profile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(configWithOpening()),
      },
    ],
    [
      "/api/support",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: "Help", message: "Please help" }),
      },
    ],
    [
      "/api/entries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(postedEntry()),
      },
    ],
  ];

  for (const [path, init] of requests) {
    const response = await workerFetch(path, init);
    assert.equal(response.status, 401, `${init.method} ${path} must require authentication`);
    const body = await response.json();
    assert.match(String(body.error ?? body.message ?? ""), /sign[ -]?in|authenticat/i);
  }
});

test("P0 storage, approval, privacy and portfolio controls are wired to immutable owner identities", async () => {
  const [auth, context, entryApi, investmentApi, investmentView, accountApi, schema] = await Promise.all([
    readFile(join(appRoot, "lib", "server", "auth.ts"), "utf8"),
    readFile(join(appRoot, "lib", "server", "context.ts"), "utf8"),
    readFile(join(appRoot, "api", "entries", "route.ts"), "utf8"),
    readFile(join(appRoot, "api", "investments", "route.ts"), "utf8"),
    readFile(join(appRoot, "components", "InvestmentsView.tsx"), "utf8"),
    readFile(join(appRoot, "api", "account", "route.ts"), "utf8"),
    readFile(join(projectRoot, "db", "schema.ts"), "utf8"),
  ]);
  assertContains(auth, /google_subject[\s\S]*auth_sessions[\s\S]*id_hash/, "Google identity must resolve to an internal user and hashed server session");
  assertContains(auth, /RSASSA-PKCS1-v1_5[\s\S]*GOOGLE_ISSUERS[\s\S]*claims\.nonce/, "Google ID tokens require signature, issuer, audience and nonce checks");
  assertExcludes(context, /CREATE TABLE|ALTER TABLE/i, "Request-time database DDL must not remain in context setup");
  assertContains(entryApi, /database\.batch\([\s\S]*aiDraftId|aiDraftId[\s\S]*database\.batch\(/, "AI approval must use an atomic D1 batch");
  assertContains(entryApi, /const journalLines[\s\S]*expectedLines = deriveJournalLines[\s\S]*sameJournalLines\(journalLines, expectedLines\)/, "AI-proposed journal lines must be fully re-derived and compared");
  assertContains(entryApi, /reversal_of[\s\S]*already been reversed|already been reversed[\s\S]*reversal_of/, "Reversals must link to the original and block duplicates");
  assertContains(schema, /sqliteTable\("manual_price_snapshots"[\s\S]*workspaceId[\s\S]*ownerKey/, "Manual prices must be owner and workspace scoped");
  assertContains(investmentApi, /FROM manual_price_snapshots[\s\S]*m\.owner_key = \?[\s\S]*m\.workspace_id = \?/, "Manual price reads must enforce owner and workspace isolation");
  assertContains(investmentView, /createdPortfolioId[\s\S]*setPanel\(null\)[\s\S]*Add first transaction/, "Portfolio creation must open the new portfolio, close the form and show the next action");
  assertContains(accountApi, /scope: "All owner-scoped records available to ACC"/, "Account export must cover the complete owner scope");
  assertContains(accountApi, /DELETE ACC DATA[\s\S]*database\.batch/, "Permanent deletion must require typed confirmation and an atomic batch");
});

test("spoofed identity headers never authenticate financial mutations", async () => {
  const spoofedHeaders = {
    "content-type": "application/json",
    "oai-authenticated-user-email": "attacker@example.com",
    "x-authenticated-user-email": "attacker@example.com",
  };
  const invalidPayloads = [
    [
      "/api/profile",
      { ...configWithOpening(), openingBankPaise: "5000000" },
    ],
    [
      "/api/entries",
      { ...postedEntry(), amountPaise: "1000000" },
    ],
    [
      "/api/entries",
      {
        ...postedEntry(),
        transactionType: "income",
        category: "rent_expense",
        debitAccount: "Bank",
        creditAccount: "Rent Expense",
      },
    ],
    [
      "/api/entries",
      {
        ...postedEntry(),
        settlement: "payable",
        debitAccount: "Accounts Payable",
      },
    ],
  ];

  for (const [path, payload] of invalidPayloads) {
    const response = await workerFetch(path, {
      method: "POST",
      headers: spoofedHeaders,
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 401, `${path} must ignore spoofed identity headers before validating ${JSON.stringify(payload)}`);
  }
});

test("server renders ACC entry without a manual Google-email impersonation field", async () => {
  const response = await workerFetch("/", {
    headers: {
      accept: "text/html",
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assertContains(html, /<title>[^<]*ACC[^<]*<\/title>/i, "The document title must name ACC");
  assertContains(html, /Your personal AI accountant/i, "The ACC entry proposition is missing");
  assertExcludes(html, /Google account email|owner@example\.com|Commerce Twin/i, "The entry screen contains a fake or obsolete identity prompt");
});

test("no active or dead app source contains fabricated finance seeds or shared-user fallbacks", async () => {
  const files = await appSourceFiles();
  const forbidden = /private-acc-owner|Math\.random|DEMO_ENTRIES|mock(?:ed)?(?:Data|Entries|Finance)|seed(?:ed)?(?:Data|Entries)|Riya Stores|owner@example\.com|ACC sample practice|sample retail business|JV-000142|15 Jul 2026|₹2,54,600|₹1,41,000|Commerce Twin|(?:Â|â€”|â€“|â‚¹)/i;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assertExcludes(source, forbidden, `Fabricated or unsafe fallback content remains in ${file}`);
  }
});
