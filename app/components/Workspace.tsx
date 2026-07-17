"use client";

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCashBridge,
  calculateAccountBalances,
  calculateFinancialSummary,
  calculateLedger,
  calculateTrialBalance,
  categoriesForTransactionType,
  categoryLabel,
  deriveJournalLines,
  filterEntriesByDateRange,
  financialYearToDateRange,
  formatDateRange,
  formatDisplayDate,
  SETTLEMENT_OPTIONS,
  settlementLabel,
  transactionTypeLabel,
  TRANSACTION_TYPES,
  validateTransactionDraft,
} from "../lib/finance";
import { formatINR, parseMoneyInput } from "../lib/money";
import { DataUnavailableState, EmptyFinancialState, MoneyInput, MoneyValue } from "./FinancialUI";
import { AskAccView } from "./AskAccView";
import { InvestmentsView } from "./InvestmentsView";
import { MarketIntelligenceView } from "./MarketIntelligenceView";
import { PulseView } from "./PulseView";
import { SettingsView } from "./SettingsView";
import type {
  DataState,
  PostedEntry,
  SettlementAccount,
  TransactionCategory,
  TransactionDraft,
  TransactionType,
  WorkspaceConfig,
} from "./types";

type MainView = "overview" | "pulse" | "books" | "accounts" | "investments" | "market" | "ask" | "settings";
type BookView = "journal" | "ledger" | "trial" | "profit" | "balance" | "cash";
type LoadedEntries = { entries: PostedEntry[]; excludedCount: number };

const CATEGORY_VALUES = new Set<TransactionCategory>([
  "sales_revenue", "service_revenue", "rent_expense", "supplies_expense",
  "payroll_expense", "utilities_expense", "marketing_expense", "other_operating_expense",
  "owner_capital", "owner_drawings", "equipment_asset", "furniture_asset", "vehicle_asset",
  "property_asset", "inventory_asset", "business_loan", "other_borrowing", "investment_asset",
  "bad_debt_expense", "provision_expense", "general_reserve", "capital_reserve",
]);
const SETTLEMENT_VALUES = new Set<SettlementAccount>(["bank", "cash", "receivable", "payable", "not_applicable"]);

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function isPostedEntry(value: unknown): value is PostedEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" || !row.id ||
    typeof row.entryNumber !== "string" || !row.entryNumber ||
    typeof row.idempotencyKey !== "string" || !row.idempotencyKey ||
    typeof row.date !== "string" ||
    typeof row.description !== "string" ||
    !Number.isSafeInteger(row.amountPaise) || Number(row.amountPaise) <= 0 ||
    !TRANSACTION_TYPES.includes(row.transactionType as TransactionType) ||
    !CATEGORY_VALUES.has(row.category as TransactionCategory) ||
    !SETTLEMENT_VALUES.has(row.settlement as SettlementAccount) ||
    typeof row.debitAccount !== "string" ||
    typeof row.creditAccount !== "string" ||
    row.status !== "posted" || (row.sourceType !== "manual" && row.sourceType !== "ai_approved") ||
    typeof row.createdBy !== "string" ||
    !Number.isSafeInteger(row.createdAt)
  ) return false;

  const candidate = row as unknown as PostedEntry;
  try {
    const lines = deriveJournalLines(candidate);
    return lines[0]?.account === candidate.debitAccount && lines[1]?.account === candidate.creditAccount;
  } catch {
    return false;
  }
}

export function Workspace({
  config,
  onSignOut,
  onEditProfile,
}: {
  config: WorkspaceConfig;
  onSignOut: () => void;
  onEditProfile: (openingBalancesLocked: boolean) => void;
}) {
  const [view, setView] = useState<MainView>("overview");
  const [bookView, setBookView] = useState<BookView>("journal");
  const [records, setRecords] = useState<DataState<LoadedEntries>>({ status: "loading" });
  const [transactionType, setTransactionType] = useState<TransactionType | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<PostedEntry | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [asOf] = useState(todayISO);
  const period = useMemo(() => financialYearToDateRange(asOf), [asOf]);

  async function loadEntries() {
    try {
      const response = await fetch("/api/entries", { cache: "no-store" });
      const body = await response.json() as { entries?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error || "We could not load your books.");
      if (!Array.isArray(body.entries)) throw new Error("The accounting record response is incomplete.");
      const entries = body.entries.filter(isPostedEntry);
      setRecords({ status: "success", data: { entries, excludedCount: body.entries.length - entries.length } });
    } catch (cause) {
      setRecords({ status: "error", message: cause instanceof Error ? cause.message : "We could not load your books." });
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadEntries(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const entries = useMemo(() => records.status === "success" ? records.data.entries : [], [records]);
  const periodEntries = useMemo(() => filterEntriesByDateRange(entries, period), [entries, period]);
  const asOfEntries = useMemo(() => entries.filter((entry) => entry.date <= asOf), [entries, asOf]);
  const summary = useMemo(() => calculateFinancialSummary(config, entries, period), [config, entries, period]);
  const bridge = useMemo(() => buildCashBridge(config, entries, period), [config, entries, period]);
  const accounts = useMemo(() => calculateAccountBalances(config, asOfEntries), [config, asOfEntries]);
  const trial = useMemo(() => calculateTrialBalance(periodEntries), [periodEntries]);

  async function postEntry(draft: TransactionDraft) {
    const response = await fetch("/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const body = await response.json() as { entry?: unknown; error?: string };
    if (!response.ok) throw new Error(body.error || "We could not post this record. Nothing in your books was changed.");
    if (!isPostedEntry(body.entry)) throw new Error("The saved entry could not be verified. Reload your books before trying again.");
    setRecords((current) => current.status === "success"
      ? { status: "success", data: { ...current.data, entries: current.data.entries.some((entry) => entry.id === (body.entry as PostedEntry).id) ? current.data.entries : [...current.data.entries, body.entry as PostedEntry] } }
      : current);
    setAnnouncement(`${body.entry.entryNumber} posted. Your overview and books are now updated.`);
    return body.entry;
  }

  async function reverseEntry(entry: PostedEntry, date: string) {
    const response = await fetch("/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reverse_entry", entryId: entry.id, date, idempotencyKey: crypto.randomUUID() }),
    });
    const body = await response.json() as { entry?: unknown; error?: string };
    if (!response.ok) throw new Error(body.error || "ACC could not post the reversal. The original entry was not changed.");
    if (!isPostedEntry(body.entry)) throw new Error("The correcting entry could not be verified. Reload Books before retrying.");
    setRecords((current) => current.status === "success"
      ? { status: "success", data: { ...current.data, entries: current.data.entries.some((row) => row.id === (body.entry as PostedEntry).id) ? current.data.entries : [...current.data.entries, body.entry as PostedEntry] } }
      : current);
    setSelectedEntry(null);
    setAnnouncement(`${body.entry.entryNumber} posted as the linked reversal of ${entry.entryNumber}.`);
    return body.entry;
  }

  function openBooks(next: BookView) {
    setBookView(next);
    setView("books");
  }

  return (
    <main className="workspace-shell">
      <TopBar config={config} asOf={asOf} onCompany={() => setCompanyOpen(true)} />
      <div className="workspace-layout">
        <Navigation view={view} onView={setView} />
        <div className="workspace-main">
          {records.status === "loading" ? <WorkspaceLoading /> : null}
          {records.status === "error" ? (
            <DataUnavailableState title="Unable to load your books" message={records.message} onRetry={() => { setRecords({ status: "loading" }); void loadEntries(); }} />
          ) : null}
          {records.status === "success" && records.data.excludedCount > 0 ? (
            <div className="integrity-notice" role="status"><strong>{records.data.excludedCount} earlier {records.data.excludedCount === 1 ? "record needs" : "records need"} your attention.</strong><span>Open Books when you’re ready to review {records.data.excludedCount === 1 ? "it" : "them"}.</span></div>
          ) : null}
          {records.status === "success" && view === "overview" ? (
            <Overview
              asOf={asOf}
              periodLabel={formatDateRange(period)}
              entries={periodEntries}
              summary={summary}
              bridge={bridge}
              onAdd={setTransactionType}
              onBooks={openBooks}
              onAccounts={() => setView("accounts")}
              onEntry={setSelectedEntry}
            />
          ) : null}
          {records.status === "success" && view === "books" ? (
            <Books
              config={config}
              entries={periodEntries}
              summary={summary}
              bridge={bridge}
              accounts={accounts.accounts}
              trial={trial}
              view={bookView}
              onView={setBookView}
              periodLabel={formatDateRange(period)}
              asOf={asOf}
              onEntry={setSelectedEntry}
            />
          ) : null}
          {records.status === "success" && view === "accounts" ? (
            <Accounts config={config} accounts={accounts.accounts} asOf={asOf} hasPostedEntries={entries.length > 0} onEditProfile={onEditProfile} />
          ) : null}
          {records.status === "success" && view === "pulse" ? (
            <PulseView config={config} entries={entries} summary={summary} onEntry={setSelectedEntry} onBooks={() => openBooks("journal")} />
          ) : null}
          {records.status === "success" && view === "investments" ? (
            <InvestmentsView onAsk={() => setView("ask")} onOpenSettings={() => setView("settings")} />
          ) : null}
          {records.status === "success" && view === "market" ? (
            <MarketIntelligenceView config={config} />
          ) : null}
          {records.status === "success" && view === "ask" ? (
            <AskAccView onPost={postEntry} onOpenSettings={() => setView("settings")} />
          ) : null}
          {records.status === "success" && view === "settings" ? (
            <SettingsView config={config} entries={entries} onSignOut={onSignOut} onEditProfile={onEditProfile} />
          ) : null}
        </div>
      </div>

      {transactionType ? <TransactionFlow initialType={transactionType} onClose={() => setTransactionType(null)} onPost={postEntry} /> : null}
      {selectedEntry ? <EntryDetail entry={selectedEntry} onClose={() => setSelectedEntry(null)} onReverse={reverseEntry} /> : null}
      {companyOpen ? <CompanyPanel config={config} onSignOut={onSignOut} hasPostedEntries={entries.length > 0} onEdit={onEditProfile} onClose={() => setCompanyOpen(false)} /> : null}
      {view !== "ask" ? <button className="assistant-launcher" onClick={() => setView("ask")} aria-label="Ask ACC"><span aria-hidden="true">A</span><strong>Ask ACC</strong><small>English · हिन्दी</small></button> : null}
      <p className="sr-announcement" aria-live="polite">{announcement}</p>
    </main>
  );
}

function TopBar({ config, asOf, onCompany }: { config: WorkspaceConfig; asOf: string; onCompany: () => void }) {
  return (
    <header className="workspace-top glass-bar">
      <div className="acc-wordmark compact"><span aria-hidden="true">A</span><strong>ACC</strong></div>
      <div className="workspace-context"><span>Your business today</span><strong>{formatDisplayDate(asOf)}</strong></div>
      <button className="company-button" onClick={onCompany} aria-label={`Open ${config.businessName} workspace settings`}><span><small>BUSINESS</small><strong>{config.businessName}</strong></span><i aria-hidden="true">⌄</i></button>
    </header>
  );
}

function Navigation({ view, onView }: { view: MainView; onView: (view: MainView) => void }) {
  const items: Array<{ value: MainView; label: string; number: string }> = [
    { value: "overview", label: "Overview", number: "01" },
    { value: "pulse", label: "ACC Pulse", number: "02" },
    { value: "books", label: "Books", number: "03" },
    { value: "accounts", label: "Accounts", number: "04" },
    { value: "investments", label: "Investments · Beta", number: "05" },
    { value: "market", label: "Market Research · Beta", number: "06" },
    { value: "ask", label: "Ask ACC", number: "07" },
    { value: "settings", label: "Settings", number: "08" },
  ];
  return <nav className="workspace-nav" aria-label="Primary"><p>EXPLORE ACC</p>{items.map((item) => <button key={item.value} className={view === item.value ? "active" : ""} aria-current={view === item.value ? "page" : undefined} onClick={() => onView(item.value)}><span>{item.number}</span><strong>{item.label}</strong><i aria-hidden="true" /></button>)}<button className="nav-integrity" onClick={() => onView("ask")}><i aria-hidden="true" /><strong>Need help?</strong><span>Ask ACC in simple words</span></button></nav>;
}

function WorkspaceLoading() {
  return <div className="workspace-loading" aria-busy="true"><div className="loading-heading" /><div className="loading-cockpit" /><div className="loading-grid">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div><p>Bringing your business into view…</p></div>;
}

type Summary = ReturnType<typeof calculateFinancialSummary>;
type Bridge = ReturnType<typeof buildCashBridge>;
type AccountRow = ReturnType<typeof calculateAccountBalances>["accounts"][number];
type Trial = ReturnType<typeof calculateTrialBalance>;

function Overview({
  asOf,
  periodLabel,
  entries,
  summary,
  bridge,
  onAdd,
  onBooks,
  onAccounts,
  onEntry,
}: {
  asOf: string;
  periodLabel: string;
  entries: PostedEntry[];
  summary: Summary;
  bridge: Bridge;
  onAdd: (type: TransactionType) => void;
  onBooks: (view: BookView) => void;
  onAccounts: () => void;
  onEntry: (entry: PostedEntry) => void;
}) {
  return (
    <div className="overview-view">
      <header className="page-heading"><div><p className="eyebrow">YOUR BUSINESS · {periodLabel}</p><h1>See how your<br />money is moving.</h1></div><p>Tap any circle to understand it. ACC keeps the accounting underneath, so this view can stay simple.</p></header>

      <MoneyMap summary={summary} asOf={asOf} onBooks={onBooks} onAccounts={onAccounts} />

      <section className="outstanding-and-actions">
        <div className="action-panel"><p className="eyebrow">TELL ACC</p><h2>What happened today?</h2><p>Choose what happened. ACC will build the debit and credit for your approval.</p><div className="action-grid"><button className="action-income" onClick={() => onAdd("income")}><span aria-hidden="true">+</span><strong>Income</strong><small>Earned or due</small></button><button className="action-expense" onClick={() => onAdd("expense")}><span aria-hidden="true">−</span><strong>Expense</strong><small>Spent or owed</small></button><button onClick={() => onAdd("capital_in")}><span aria-hidden="true">C</span><strong>Capital</strong><small>Owner put money in</small></button><button onClick={() => onAdd("asset_purchase")}><span aria-hidden="true">A</span><strong>Asset</strong><small>Bought for the business</small></button><button onClick={() => onAdd("liability_borrow")}><span aria-hidden="true">L</span><strong>Liability</strong><small>Borrowed money</small></button></div><details className="professional-actions"><summary>More accounting actions</summary><div><button onClick={() => onAdd("receivable_collection")}>Collect receivable</button><button onClick={() => onAdd("supplier_payment")}>Pay supplier</button><button onClick={() => onAdd("customer_advance")}>Customer advance</button><button onClick={() => onAdd("supplier_advance")}>Supplier advance</button><button onClick={() => onAdd("sales_return")}>Sales return</button><button onClick={() => onAdd("purchase_return")}>Purchase return</button><button onClick={() => onAdd("drawings")}>Drawings</button><button onClick={() => onAdd("liability_repay")}>Repay liability</button><button onClick={() => onAdd("investment_purchase")}>Investment</button><button onClick={() => onAdd("depreciation")}>Depreciation</button><button onClick={() => onAdd("tax_payment")}>Pay GST / TDS</button><button onClick={() => onAdd("bad_debt")}>Bad debt</button><button onClick={() => onAdd("provision_create")}>Provision</button><button onClick={() => onAdd("reserve_transfer")}>Reserve transfer</button></div></details></div>
        <button className="books-door glass-panel" onClick={() => onBooks("journal")}><span className="eyebrow">BOOKS</span><strong>Want the accounting detail?</strong><small>Open Journal, Ledger and reports</small><i aria-hidden="true">→</i></button>
      </section>

      <CashBridgePanel bridge={bridge} onOpen={() => onBooks("cash")} onAdd={onAdd} />
      <RecentActivity entries={entries} onEntry={onEntry} onAdd={onAdd} />
    </div>
  );
}

function MoneyMap({ summary, asOf, onBooks, onAccounts }: { summary: Summary; asOf: string; onBooks: (view: BookView) => void; onAccounts: () => void }) {
  const available = summary.availableCash.amountPaise;
  const canSplitCash = available > 0 && summary.cashAtBank.amountPaise >= 0 && summary.cashInHand.amountPaise >= 0;
  const bankAngle = canSplitCash ? Math.round((summary.cashAtBank.amountPaise / available) * 360) : 0;
  const hasMovement = summary.revenue.amountPaise > 0 || summary.expenses.amountPaise > 0;
  const show = (amountPaise: number, empty: string) => amountPaise === 0 ? <small>{empty}</small> : <MoneyValue amountPaise={amountPaise} />;
  return (
    <section className={`money-map-section${hasMovement || available !== 0 ? " has-data" : " is-empty"}`} aria-labelledby="money-map-heading">
      <header className="money-map-heading"><div><p className="eyebrow">MONEY MAP</p><h2 id="money-map-heading">Your business at a glance.</h2></div><span>Updated {formatDisplayDate(asOf)}</span></header>
      <div className="money-map">
        <div className="map-rail rail-earned" aria-hidden="true" /><div className="map-rail rail-spent" aria-hidden="true" /><div className="map-rail rail-bank" aria-hidden="true" /><div className="map-rail rail-cash" aria-hidden="true" /><div className="map-rail rail-due" aria-hidden="true" />
        <button className="money-node node-earned" onClick={() => onBooks("profit")}><span>Money earned</span>{show(summary.revenue.amountPaise, "No income yet")}<i aria-hidden="true">↘</i></button>
        <button className="money-node node-spent" onClick={() => onBooks("profit")}><span>Money spent</span>{show(summary.expenses.amountPaise, "No expenses yet")}<i aria-hidden="true">↙</i></button>
        <button className={`money-core${canSplitCash ? " split" : " empty-ring"}`} style={{ "--bank-angle": `${bankAngle}deg` } as CSSProperties} onClick={() => onBooks("cash")}>
          <i className="money-ring" aria-hidden="true" /><span>Available now</span>{available === 0 ? <strong>Ready when<br />you are</strong> : <MoneyValue amountPaise={available} />}<small>Tap to follow the cash</small>
        </button>
        <button className="money-node node-bank" onClick={onAccounts}><span>In the bank</span>{show(summary.cashAtBank.amountPaise, "Nothing added")}<i aria-hidden="true">→</i></button>
        <button className="money-node node-cash" onClick={onAccounts}><span>Cash in hand</span>{show(summary.cashInHand.amountPaise, "Nothing added")}<i aria-hidden="true">←</i></button>
        <button className="money-node node-due" onClick={onAccounts}><span>Still to receive</span>{show(summary.receivables.amountPaise, "Nothing due")}<i aria-hidden="true">↑</i></button>
        <button className="money-node node-pay" onClick={onAccounts}><span>Still to pay</span>{show(summary.payables.amountPaise, "Nothing due")}<i aria-hidden="true">↑</i></button>
      </div>
      <div className="balance-map-summary"><button onClick={onAccounts}><span>Assets owned</span>{summary.totalAssetsPaise ? <MoneyValue amountPaise={summary.totalAssetsPaise} /> : <small>None recorded</small>}</button><i aria-hidden="true">=</i><button onClick={() => onBooks("balance")}><span>Liabilities</span>{summary.totalLiabilitiesPaise ? <MoneyValue amountPaise={summary.totalLiabilitiesPaise} /> : <small>None recorded</small>}</button><i aria-hidden="true">+</i><button onClick={() => onBooks("balance")}><span>Capital & reserves</span>{summary.equityPaise === null ? <small>Needs opening capital</small> : <MoneyValue amountPaise={summary.equityPaise} />}</button></div>
      {!hasMovement && available === 0 ? <div className="map-empty-note"><span aria-hidden="true">✦</span><p><strong>Your money map is ready.</strong> Add your first income or expense and the circles will grow from your entries.</p></div> : null}
    </section>
  );
}

function CashBridgePanel({ bridge, onOpen, onAdd }: { bridge: Bridge; onOpen: () => void; onAdd: (type: TransactionType) => void }) {
  return (
    <section className="bridge-section" aria-labelledby="bridge-heading">
      <div className="section-heading"><div><p className="eyebrow">FOLLOW THE MONEY</p><h2 id="bridge-heading">From start to finish.</h2></div><button className="text-button" onClick={onOpen}>See cash movement</button></div>
      {bridge.transactionCount === 0 ? <EmptyFinancialState eyebrow="YOUR FIRST FLOW" title="No money has moved through ACC yet." body="Add income or an expense to see its path through the business." actionLabel="Add first income" onAction={() => onAdd("income")} /> : (
        <div className="cash-bridge" role="img" aria-label={`Opening cash ${formatINR(bridge.openingCashPaise)}, plus cash received ${formatINR(bridge.cashInflowsPaise)}, minus cash spent ${formatINR(bridge.cashOutflowsPaise)}, equals closing cash ${formatINR(bridge.closingCashPaise)}`}>
          <article className="bridge-node opening"><span>Opening Cash</span><MoneyValue amountPaise={bridge.openingCashPaise} /><small>Before this period</small></article><i className="bridge-operator">+</i>
          <article className="bridge-node incoming"><span>Cash Received</span><MoneyValue amountPaise={bridge.cashInflowsPaise} /><small>Posted cash inflows</small></article><i className="bridge-operator">−</i>
          <article className="bridge-node outgoing"><span>Cash Spent</span><MoneyValue amountPaise={bridge.cashOutflowsPaise} /><small>Posted cash outflows</small></article><i className="bridge-operator">=</i>
          <article className="bridge-node closing"><span>Available Now</span><MoneyValue amountPaise={bridge.closingCashPaise} /><small>After these movements</small></article>
          <div className="bridge-rail" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}

function RecentActivity({ entries, onEntry, onAdd }: { entries: PostedEntry[]; onEntry: (entry: PostedEntry) => void; onAdd: (type: TransactionType) => void }) {
  const recent = [...entries].sort((left, right) => right.createdAt - left.createdAt).slice(0, 6);
  const incoming = (type: TransactionType) => type === "income" || type === "capital_in" || type === "liability_borrow";
  const noCash = (type: TransactionType) => type === "bad_debt" || type === "provision_create" || type === "reserve_transfer";
  return <section className="activity-section"><div className="section-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Recent activity.</h2></div><span>{entries.length} posted {entries.length === 1 ? "record" : "records"}</span></div>{recent.length === 0 ? <EmptyFinancialState eyebrow="NO ACTIVITY YET" title="Actions taken in ACC will appear here." body="Opening bank, cash and capital are setup information, so they are not shown as period activity." actionLabel="Add income" onAction={() => onAdd("income")} /> : <div className="activity-list">{recent.map((entry) => <button key={entry.id} onClick={() => onEntry(entry)}><span className={`activity-direction ${entry.transactionType}`} aria-hidden="true">{noCash(entry.transactionType) ? "·" : incoming(entry.transactionType) ? "+" : "−"}</span><span><strong>{entry.description}</strong><small>{entry.entryNumber} · {transactionTypeLabel(entry.transactionType)} · {formatDisplayDate(entry.date)}</small></span><MoneyValue amountPaise={entry.amountPaise} /><i>Posted</i></button>)}</div>}</section>;
}

function Books({
  config,
  entries,
  summary,
  bridge,
  accounts,
  trial,
  view,
  onView,
  periodLabel,
  asOf,
  onEntry,
}: {
  config: WorkspaceConfig;
  entries: PostedEntry[];
  summary: Summary;
  bridge: Bridge;
  accounts: readonly AccountRow[];
  trial: Trial;
  view: BookView;
  onView: (view: BookView) => void;
  periodLabel: string;
  asOf: string;
  onEntry: (entry: PostedEntry) => void;
}) {
  const tabs: Array<{ value: BookView; label: string }> = [
    { value: "journal", label: "Journal" }, { value: "ledger", label: "Ledger" },
    { value: "trial", label: "Trial Balance" }, { value: "profit", label: "Profit & Loss" },
    { value: "balance", label: "Balance Sheet" }, { value: "cash", label: "Cash Movement" },
  ];
  return (
    <div className="books-view">
      <header className="page-heading"><div><p className="eyebrow">YOUR BOOKS</p><h1>The accounting,<br />when you need it.</h1></div><p>Journal, Ledger and statements are kept together here. Choose a tab to open a report.</p></header>
      <nav className="book-tabs" aria-label="Accounting reports">{tabs.map((tab) => <button key={tab.value} className={view === tab.value ? "active" : ""} aria-current={view === tab.value ? "page" : undefined} onClick={() => onView(tab.value)}>{tab.label}</button>)}</nav>
      <section className="report-paper">
        <header className="report-head"><div><span>{config.businessName}</span><strong>{tabs.find((tab) => tab.value === view)?.label}</strong></div><div><span>{view === "balance" ? "AS OF" : "PERIOD"}</span><strong>{view === "balance" ? formatDisplayDate(asOf) : periodLabel}</strong></div></header>
        {view === "journal" ? <JournalTable entries={entries} onEntry={onEntry} /> : null}
        {view === "ledger" ? <LedgerTable config={config} entries={entries} accounts={accounts} /> : null}
        {view === "trial" ? <TrialTable trial={trial} hasOpening={config.openingBankPaise + config.cashInHandPaise + config.openingCapitalPaise > 0} /> : null}
        {view === "profit" ? <ProfitAndLoss summary={summary} /> : null}
        {view === "balance" ? <BalanceSheet summary={summary} accounts={accounts} /> : null}
        {view === "cash" ? <CashMovement bridge={bridge} entries={entries} onEntry={onEntry} /> : null}
      </section>
    </div>
  );
}

function JournalTable({ entries, onEntry }: { entries: PostedEntry[]; onEntry: (entry: PostedEntry) => void }) {
  if (!entries.length) return <EmptyFinancialState eyebrow="JOURNAL EMPTY" title="No journal entries have been created." body="Opening balances are not silently turned into journal entries. Approved income and expenses will appear here with equal debits and credits." />;
  return <div className="table-scroll"><table className="financial-table journal-table"><thead><tr><th>Date</th><th>Entry</th><th>Source / description</th><th>Account</th><th>Debit</th><th>Credit</th><th>Status</th><th>Created by</th><th>Posted</th></tr></thead><tbody>{entries.flatMap((entry) => deriveJournalLines(entry).map((line, index) => <tr key={`${entry.id}-${line.account}`} onClick={() => onEntry(entry)}><td data-label="Date">{formatDisplayDate(entry.date)}</td><td data-label="Entry">{entry.entryNumber}</td><td data-label="Source / description"><strong>{index === 0 ? entry.description : "Supporting journal line"}</strong><small>Manual transaction · inspect source</small></td><td data-label="Account">{line.account}</td><td data-label="Debit">{line.debitPaise ? formatINR(line.debitPaise) : "—"}</td><td data-label="Credit">{line.creditPaise ? formatINR(line.creditPaise) : "—"}</td><td data-label="Status"><span className="status-posted">Posted</span></td><td data-label="Created by">{entry.createdBy}</td><td data-label="Posted">{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))}</td></tr>))}</tbody></table></div>;
}

function LedgerTable({ config, entries, accounts }: { config: WorkspaceConfig; entries: PostedEntry[]; accounts: readonly AccountRow[] }) {
  const selectable = accounts;
  const [account, setAccount] = useState(selectable[0]?.account ?? "Bank");
  const lines = calculateLedger(entries, account);
  const opening = account === "Bank" ? config.openingBankPaise : account === "Cash in Hand" ? config.cashInHandPaise : 0;
  return <div className="ledger-report"><label>Account<select value={account} onChange={(event) => setAccount(event.target.value)}>{selectable.map((row) => <option key={row.account}>{row.account}</option>)}</select></label>{opening ? <div className="opening-ledger-note"><span>Owner-provided opening balance</span><MoneyValue amountPaise={opening} /><small>Shown for context; not a posted journal entry.</small></div> : null}{lines.length === 0 ? <EmptyFinancialState eyebrow="NO POSTED MOVEMENT" title={`No journal movement for ${account}.`} body="A setup opening balance may still appear above, but it is not presented as a transaction." /> : <div className="table-scroll"><table className="financial-table"><thead><tr><th>Date</th><th>Entry</th><th>Description</th><th>Debit</th><th>Credit</th><th>Running debit − credit</th></tr></thead><tbody>{lines.map((line) => <tr key={`${line.entryId}-${account}`}><td data-label="Date">{formatDisplayDate(line.date)}</td><td data-label="Entry">{line.entryNumber}</td><td data-label="Description">{line.description}</td><td data-label="Debit">{line.debitPaise ? formatINR(line.debitPaise) : "—"}</td><td data-label="Credit">{line.creditPaise ? formatINR(line.creditPaise) : "—"}</td><td data-label="Running debit minus credit">{formatINR(line.runningDebitMinusCreditPaise)}</td></tr>)}</tbody></table></div>}</div>;
}

function TrialTable({ trial, hasOpening }: { trial: Trial; hasOpening: boolean }) {
  if (!trial.rows.length) return <EmptyFinancialState eyebrow="TRIAL BALANCE EMPTY" title="No posted journal entries to total." body="Opening bank, cash and capital are setup balances. Your first approved business action will create the first posted journal entry." />;
  return <><div className="table-scroll"><table className="financial-table"><thead><tr><th>Account</th><th>Total Debit</th><th>Total Credit</th></tr></thead><tbody>{trial.rows.map((row) => <tr key={row.account}><td data-label="Account">{row.account}</td><td data-label="Total Debit">{row.debitPaise ? formatINR(row.debitPaise) : "—"}</td><td data-label="Total Credit">{row.creditPaise ? formatINR(row.creditPaise) : "—"}</td></tr>)}</tbody><tfoot><tr><th>Posted-entry totals</th><th>{formatINR(trial.totalDebitsPaise)}</th><th>{formatINR(trial.totalCreditsPaise)}</th></tr></tfoot></table></div><p className={`balance-proof ${trial.isBalanced ? "balanced" : "unbalanced"}`}>{trial.isBalanced ? "Total Debit = Total Credit" : "The posted entries are not balanced. Posting should be stopped and reviewed."}</p>{hasOpening ? <p className="report-disclosure">Setup opening bank, cash and capital are shown in Accounts and the Balance Sheet, but not repeated as period activity here.</p> : null}</>;
}

function ProfitAndLoss({ summary }: { summary: Summary }) {
  if (!summary.profit) return <EmptyFinancialState eyebrow="INSUFFICIENT DATA" title="Not enough data to calculate profit." body="Post a real revenue or expense transaction. ACC will calculate profit only as posted revenue minus recognised expenses for the visible period." />;
  return <div className="statement"><dl><div><dt>Revenue</dt><dd>{formatINR(summary.revenue.amountPaise)}</dd></div><div><dt>Recognised expenses</dt><dd>({formatINR(summary.expenses.amountPaise)})</dd></div><div className="statement-total"><dt>{summary.profit.amountPaise < 0 ? "Loss" : "Profit"}</dt><dd>{formatINR(summary.profit.amountPaise)}</dd></div></dl><p>Calculation: posted revenue − posted recognised expenses. Opening cash is excluded.</p></div>;
}

function BalanceSheet({ summary, accounts }: { summary: Summary; accounts: readonly AccountRow[] }) {
  if (!summary.balanceSheetReady || summary.equityPaise === null) return <div className="balance-gap"><span>OPENING CLASSIFICATION</span><h2>One exact difference needs your attention.</h2><MoneyValue amountPaise={Math.abs(summary.balanceSheetDifferencePaise)} /><p>{summary.balanceSheetDifferencePaise > 0 ? "Assets are higher than their recorded capital and liabilities by this amount." : "Recorded capital and liabilities are higher than assets by this amount."} Edit the opening capital, or post the actual liability that funded the opening money.</p></div>;
  const visible = (type: AccountRow["accountType"]) => accounts.filter((row) => row.accountType === type && row.balancePaise !== 0);
  const earnings = summary.equityPaise - summary.capitalPaise + summary.drawingsPaise - summary.reservesPaise;
  return <div className="balance-statement"><div className="statement-column"><h3>Assets</h3>{visible("asset").map((row) => <div key={row.account}><span>{row.account}</span><strong>{formatINR(row.balancePaise)}</strong></div>)}<footer><span>Total assets</span><strong>{formatINR(summary.totalAssetsPaise)}</strong></footer></div><div className="statement-column"><h3>Liabilities</h3>{visible("liability").length ? visible("liability").map((row) => <div key={row.account}><span>{row.account}</span><strong>{formatINR(row.balancePaise)}</strong></div>) : <p>No liabilities recorded.</p>}<footer><span>Total liabilities</span><strong>{formatINR(summary.totalLiabilitiesPaise)}</strong></footer><h3 className="capital-heading">Capital & reserves</h3><div><span>Owner / partners’ capital</span><strong>{formatINR(summary.capitalPaise)}</strong></div>{summary.drawingsPaise ? <div><span>Less: drawings</span><strong>({formatINR(summary.drawingsPaise)})</strong></div> : null}{summary.reservesPaise ? <div><span>Reserves</span><strong>{formatINR(summary.reservesPaise)}</strong></div> : null}<div><span>Accumulated earnings</span><strong>{formatINR(earnings)}</strong></div><footer><span>Total capital</span><strong>{formatINR(summary.equityPaise)}</strong></footer></div><p className="balance-equation">Assets {formatINR(summary.totalAssetsPaise)} = liabilities and capital {formatINR(summary.totalLiabilitiesPaise + summary.equityPaise)}.</p></div>;
}

function CashMovement({ bridge, entries, onEntry }: { bridge: Bridge; entries: PostedEntry[]; onEntry: (entry: PostedEntry) => void }) {
  const cashEntries = entries.filter((entry) => entry.settlement === "bank" || entry.settlement === "cash");
  if (!cashEntries.length) return <EmptyFinancialState eyebrow="NO CASH MOVEMENT" title="No cash or bank transactions in this period." body={`Opening cash of ${formatINR(bridge.openingCashPaise)} is a starting balance, not cash received during the period.`} />;
  return <div className="cash-report"><div className="cash-reconciliation"><span>Opening Cash<strong>{formatINR(bridge.openingCashPaise)}</strong></span><i>+</i><span>Cash Received<strong>{formatINR(bridge.cashInflowsPaise)}</strong></span><i>−</i><span>Cash Spent<strong>{formatINR(bridge.cashOutflowsPaise)}</strong></span><i>=</i><span>Closing Cash<strong>{formatINR(bridge.closingCashPaise)}</strong></span></div><div className="table-scroll"><table className="financial-table"><thead><tr><th>Date</th><th>Entry</th><th>Description</th><th>Account</th><th>Cash In</th><th>Cash Out</th></tr></thead><tbody>{cashEntries.map((entry) => { const account = entry.settlement === "bank" ? "Bank" : "Cash in Hand"; const line = deriveJournalLines(entry).find((item) => item.account === account); return <tr key={entry.id} onClick={() => onEntry(entry)}><td data-label="Date">{formatDisplayDate(entry.date)}</td><td data-label="Entry">{entry.entryNumber}</td><td data-label="Description">{entry.description}</td><td data-label="Account">{settlementLabel(entry.settlement)}</td><td data-label="Cash In">{line?.debitPaise ? formatINR(line.debitPaise) : "—"}</td><td data-label="Cash Out">{line?.creditPaise ? formatINR(line.creditPaise) : "—"}</td></tr>; })}</tbody></table></div></div>;
}

function Accounts({ config, accounts, asOf, hasPostedEntries, onEditProfile }: { config: WorkspaceConfig; accounts: readonly AccountRow[]; asOf: string; hasPostedEntries: boolean; onEditProfile: (openingBalancesLocked: boolean) => void }) {
  const groups: Array<{ type: AccountRow["accountType"]; title: string; note: string }> = [{ type: "asset", title: "Assets", note: "What the business owns or can collect" }, { type: "liability", title: "Liabilities", note: "What the business owes" }, { type: "equity", title: "Capital & reserves", note: "Owner funding, drawings and retained amounts" }, { type: "income", title: "Income", note: "What the business earned" }, { type: "expense", title: "Expenses & provisions", note: "Costs, bad debts and provision charges" }];
  return <div className="accounts-view"><header className="page-heading"><div><p className="eyebrow">CHART OF ACCOUNTS</p><h1>Every account,<br />in its proper place.</h1></div><p>Assets, liabilities, capital, reserves, income and expenses stay separate. Each balance comes from setup or an approved journal entry.</p></header><div className="accounts-toolbar"><span>As of {formatDisplayDate(asOf)}</span><button className="button button-secondary" onClick={() => onEditProfile(hasPostedEntries)}>{hasPostedEntries ? "Edit workspace" : "Edit opening balances"}</button></div>{hasPostedEntries ? <p className="opening-lock-note">Opening money is locked after your first entry, including opening capital. Later changes belong in the Journal.</p> : null}{groups.map((group) => <section className="account-group" key={group.type}><header><div><span>{group.title}</span><small>{group.note}</small></div><b>{accounts.filter((row) => row.accountType === group.type).filter((row) => row.balancePaise !== 0).length} active</b></header><div className="account-list">{accounts.filter((row) => row.accountType === group.type).map((account) => <article key={account.account}><header><div><span>{account.accountType}</span><h2>{account.account}</h2></div>{account.balancePaise === 0 ? <small className="account-empty">No balance yet</small> : <MoneyValue className="account-amount" amountPaise={account.balancePaise} />}</header><dl><div><dt>Source</dt><dd>{account.lastTransactionDate ? "Approved journal entries" : account.source === "opening_balance" ? "Workspace setup" : "No activity"}</dd></div><div><dt>Last change</dt><dd>{account.lastTransactionDate ? formatDisplayDate(account.lastTransactionDate) : account.source === "opening_balance" && config.updatedAt ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(config.updatedAt)) : "—"}</dd></div></dl></article>)}</div></section>)}</div>;
}

const TRANSACTION_COPY: Record<TransactionType, { title: string; prompt: string; placeholder: string; settlement: string }> = {
  income: { title: "Add income", prompt: "Record money earned or still due from a customer.", placeholder: "For example: Client paid for a website", settlement: "Where was it received?" },
  expense: { title: "Add expense", prompt: "Record a cost paid now or still owed to a supplier.", placeholder: "For example: Paid the shop electricity bill", settlement: "How was it paid?" },
  capital_in: { title: "Introduce capital", prompt: "Record money the owner or partners put into the business.", placeholder: "For example: Owner introduced more capital", settlement: "Where did the capital arrive?" },
  drawings: { title: "Record drawings", prompt: "Record money taken by the owner for personal use. This is not a business expense.", placeholder: "For example: Owner withdrew money for personal use", settlement: "Where was it taken from?" },
  asset_purchase: { title: "Buy an asset", prompt: "Record something the business owns and will use or sell.", placeholder: "For example: Bought a laptop for the office", settlement: "How was the asset funded?" },
  liability_borrow: { title: "Add a liability", prompt: "Record money borrowed by the business.", placeholder: "For example: Business loan received from the bank", settlement: "Where did the borrowed money arrive?" },
  liability_repay: { title: "Repay a liability", prompt: "Reduce a recorded loan or borrowing when it is repaid.", placeholder: "For example: Repaid part of the business loan", settlement: "Where was the repayment made from?" },
  investment_purchase: { title: "Buy an investment", prompt: "Record an investment held by the business as an asset.", placeholder: "For example: Business purchased a fixed deposit", settlement: "How was the investment paid for?" },
  bad_debt: { title: "Write off a bad debt", prompt: "Reduce money a customer owes only when it is no longer recoverable.", placeholder: "For example: Customer balance confirmed unrecoverable", settlement: "Customer balance affected" },
  provision_create: { title: "Recognise a provision", prompt: "Record a present obligation with an amount that can be estimated reliably.", placeholder: "For example: Provision recognised for a known legal obligation", settlement: "Cash movement" },
  reserve_transfer: { title: "Move profit to a reserve", prompt: "Reclassify existing retained profit. This does not create an expense or extra cash.", placeholder: "For example: Transfer retained profit to general reserve", settlement: "Cash movement" },
  receivable_collection: { title: "Collect a customer balance", prompt: "Clear money already owed without recording revenue twice.", placeholder: "For example: Received Rahul's previous credit-sale balance", settlement: "Where was it received?" },
  supplier_payment: { title: "Pay a supplier balance", prompt: "Clear an existing payable without recording the expense twice.", placeholder: "For example: Paid Mehta against the amount already due", settlement: "How was it paid?" },
  sales_return: { title: "Record a sales return", prompt: "Record goods returned by a customer and the related refund or receivable reduction.", placeholder: "For example: Customer returned goods", settlement: "How was the customer credited?" },
  purchase_return: { title: "Record a purchase return", prompt: "Record goods returned to a supplier and the refund or payable reduction.", placeholder: "For example: Returned damaged stock to supplier", settlement: "How did the supplier credit you?" },
  customer_advance: { title: "Receive a customer advance", prompt: "Record money received before revenue is earned.", placeholder: "For example: Customer paid an advance for next month's work", settlement: "Where was it received?" },
  supplier_advance: { title: "Pay a supplier advance", prompt: "Record money paid before the purchase or expense is recognised.", placeholder: "For example: Paid an advance to the equipment supplier", settlement: "How was it paid?" },
  depreciation: { title: "Record depreciation", prompt: "Recognise the period's depreciation without moving cash.", placeholder: "For example: Monthly depreciation on office equipment", settlement: "Cash movement" },
  tax_payment: { title: "Pay GST or TDS", prompt: "Reduce an existing tax liability when it is paid.", placeholder: "For example: Paid GST payable through bank", settlement: "How was it paid?" },
  reversal: { title: "Reverse an entry", prompt: "Choose a posted entry from Books so ACC can create a linked correcting entry.", placeholder: "Select the original entry in Books", settlement: "Cash movement" },
};

function startingClassification(type: TransactionType) {
  const category = categoriesForTransactionType(type)[0]?.value ?? "other_operating_expense";
  const settlement: SettlementAccount = type === "bad_debt" ? "receivable" : type === "provision_create" || type === "reserve_transfer" || type === "depreciation" || type === "reversal" ? "not_applicable" : "bank";
  return { category, settlement };
}

function TransactionFlow({ initialType, onClose, onPost }: { initialType: TransactionType; onClose: () => void; onPost: (draft: TransactionDraft) => Promise<PostedEntry> }) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [stage, setStage] = useState<"edit" | "review">("edit");
  const [type, setType] = useState<TransactionType>(initialType);
  const [description, setDescription] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [date, setDate] = useState(todayISO());
  const initialClassification = startingClassification(initialType);
  const [category, setCategory] = useState<TransactionCategory>(initialClassification.category);
  const [settlement, setSettlement] = useState<SettlementAccount>(initialClassification.settlement);
  const [draft, setDraft] = useState<TransactionDraft | null>(null);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);

  function changeType(next: TransactionType) {
    setType(next);
    const nextClassification = startingClassification(next);
    setCategory(nextClassification.category);
    setSettlement(nextClassification.settlement);
  }

  function prepareReview() {
    const parsed = parseMoneyInput(amountInput);
    if (!parsed.ok) { setError(parsed.error); return; }
    const candidate: TransactionDraft = { idempotencyKey, date, description: description.trim(), amountPaise: parsed.paise, transactionType: type, category, settlement };
    const validation = validateTransactionDraft(candidate);
    if (!validation.valid) { setError(Object.values(validation.errors)[0] || "Complete the transaction details."); return; }
    setDraft(candidate); setError(""); setStage("review");
  }

  async function post() {
    if (!draft) return;
    setPosting(true); setError("");
    try { await onPost(draft); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "We could not post this record. Nothing in your books was changed."); }
    finally { setPosting(false); }
  }

  const copy = TRANSACTION_COPY[type];
  const settlements = SETTLEMENT_OPTIONS.filter((item) => item.permittedFor.includes(type));
  return <ModalFrame label={stage === "edit" ? copy.title : "Review accounting entry"} onClose={posting ? undefined : onClose} wide>{stage === "edit" ? <div className="transaction-editor"><header><p className="eyebrow">WHAT HAPPENED TODAY?</p><h2>{copy.title}.</h2><p>{copy.prompt} You’ll see the journal entry before anything is posted.</p></header>{type === "income" || type === "expense" ? <div className="transaction-type-switch" role="radiogroup" aria-label="Transaction type"><button role="radio" aria-checked={type === "income"} className={type === "income" ? "selected" : ""} onClick={() => changeType("income")}>Money came in / is due</button><button role="radio" aria-checked={type === "expense"} className={type === "expense" ? "selected" : ""} onClick={() => changeType("expense")}>Money went out / is owed</button></div> : <div className="transaction-kind-banner"><span>{transactionTypeLabel(type)}</span><small>ACC will keep this separate from income and day-to-day expenses.</small></div>}<label className="modal-field">What happened?<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={copy.placeholder} maxLength={240} autoFocus /></label><MoneyInput label="Amount" value={amountInput} onChange={setAmountInput} help="Use the exact amount from the supporting record." error={error || undefined} /><div className="field-pair"><label className="modal-field">When did it happen?<input type="date" value={date} max={todayISO()} onChange={(event) => setDate(event.target.value)} /></label><label className="modal-field">Which account applies?<select value={category} onChange={(event) => setCategory(event.target.value as TransactionCategory)}>{categoriesForTransactionType(type).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>{settlements.length === 1 && settlements[0].value === "not_applicable" ? <div className="transaction-no-cash"><span>{copy.settlement}</span><strong>No bank or cash movement</strong></div> : <label className="modal-field">{copy.settlement}<select value={settlement} onChange={(event) => setSettlement(event.target.value as SettlementAccount)}>{settlements.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}{error ? <p className="modal-error" role="alert">{error}</p> : null}<footer className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={prepareReview}>Show me what changes <span aria-hidden="true">→</span></button></footer></div> : draft ? <TransactionReview draft={draft} posting={posting} error={error} onBack={() => { setError(""); setStage("edit"); }} onPost={() => void post()} /> : null}</ModalFrame>;
}

function TransactionReview({ draft, posting, error, onBack, onPost }: { draft: TransactionDraft; posting: boolean; error: string; onBack: () => void; onPost: () => void }) {
  const [layer, setLayer] = useState<"source" | "journal" | "effect">("journal");
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const lines = deriveJournalLines(draft);
  const style = { "--tilt-x": `${tilt.x}deg`, "--tilt-y": `${tilt.y}deg` } as CSSProperties;
  const amount = formatINR(draft.amountPaise);
  const effect: Record<TransactionType, string> = {
    income: `${lines[0].account} increases by ${amount}. Revenue increases by the same amount.`,
    expense: `${lines[1].account} ${draft.settlement === "payable" ? "increases" : "decreases"} by ${amount}. Expenses increase by the same amount.`,
    capital_in: `${lines[0].account} and owner's capital both increase by ${amount}. Profit does not change.`,
    drawings: `${lines[1].account} decreases by ${amount}. Drawings reduce owner equity; they are not an expense.`,
    asset_purchase: `${lines[0].account} increases by ${amount}. ${draft.settlement === "payable" ? "Accounts payable increases" : `${lines[1].account} decreases`} by the same amount.`,
    liability_borrow: `${lines[0].account} and ${lines[1].account} both increase by ${amount}. Profit does not change.`,
    liability_repay: `${lines[0].account} and ${lines[1].account} both decrease by ${amount}.`,
    investment_purchase: `Investments increase by ${amount} and ${lines[1].account} decreases by the same amount. Profit does not change.`,
    bad_debt: `Accounts Receivable decreases by ${amount} and Bad Debts Expense increases by the same amount.`,
    provision_create: `A provision liability and provision expense both increase by ${amount}. No cash moves now.`,
    reserve_transfer: `${amount} moves from retained earnings to ${lines[1].account}. Total equity and cash do not change.`,
    receivable_collection: `Available money increases by ${amount} and Accounts Receivable decreases. Revenue is not recorded again.`,
    supplier_payment: `Accounts Payable and available money both decrease by ${amount}. Expense is not recorded again.`,
    sales_return: `Sales Returns increases by ${amount}; the refund or customer balance changes by the same amount.`,
    purchase_return: `Purchase Returns increases by ${amount}; the refund or supplier balance changes by the same amount.`,
    customer_advance: `Available money and Customer Advances both increase by ${amount}. Revenue is not recorded yet.`,
    supplier_advance: `Supplier Advances increases and available money decreases by ${amount}. Expense is not recorded yet.`,
    depreciation: `Depreciation Expense and Accumulated Depreciation both increase by ${amount}. Cash does not move.`,
    tax_payment: `The selected tax liability and available money both decrease by ${amount}.`,
    reversal: `The selected posted journal is reversed with equal and opposite lines.`,
  };
  return <div className="transaction-review"><header><p className="eyebrow">LOOK BEFORE YOU POST</p><h2>What happened → what changes.</h2><p>Tap each layer to understand the action in your words, in the books, and in the business.</p></header><div className="review-grid"><div className="accounting-object" style={style} onPointerMove={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setTilt({ x: ((event.clientY - bounds.top) / bounds.height - .5) * -4, y: ((event.clientX - bounds.left) / bounds.width - .5) * 6 }); }} onPointerLeave={() => setTilt({ x: 0, y: 0 })}><button className={`accounting-slab source ${layer === "source" ? "active" : ""}`} onClick={() => setLayer("source")}><span>01 · WHAT HAPPENED</span><strong>{draft.description}</strong><small>{formatINR(draft.amountPaise)} · {formatDisplayDate(draft.date)}</small></button><button className={`accounting-slab journal ${layer === "journal" ? "active" : ""}`} onClick={() => setLayer("journal")}><span>02 · IN YOUR BOOKS</span><strong>{lines[0].account} / {lines[1].account}</strong><small>Debit and credit</small></button><button className={`accounting-slab effect ${layer === "effect" ? "active" : ""}`} onClick={() => setLayer("effect")}><span>03 · FOR YOUR BUSINESS</span><strong>{transactionTypeLabel(draft.transactionType)}</strong><small>{settlementLabel(draft.settlement)}</small></button><div className="object-rail" aria-hidden="true"><i /><i /><i /></div></div><div className="layer-inspector">{layer === "source" ? <><span>YOUR DETAILS</span><h3>{draft.description}</h3><dl><div><dt>Amount</dt><dd>{formatINR(draft.amountPaise)}</dd></div><div><dt>Date</dt><dd>{formatDisplayDate(draft.date)}</dd></div><div><dt>Account selected</dt><dd>{categoryLabel(draft.category)}</dd></div></dl></> : null}{layer === "journal" ? <><span>THE ACCOUNTING</span><h3>What will enter the Journal</h3><div className="review-journal"><header><span>Account</span><span>Debit</span><span>Credit</span></header>{lines.map((line) => <div key={line.account}><strong>{line.account}</strong><span>{line.debitPaise ? formatINR(line.debitPaise) : "—"}</span><span>{line.creditPaise ? formatINR(line.creditPaise) : "—"}</span></div>)}<footer><strong>Total</strong><span>{formatINR(draft.amountPaise)}</span><span>{formatINR(draft.amountPaise)}</span></footer></div></> : null}{layer === "effect" ? <><span>THE SIMPLE EFFECT</span><h3>{effect[draft.transactionType]}</h3><p>You’ll be able to open this again from Recent activity and your Journal.</p></> : null}</div></div>{error ? <p className="modal-error" role="alert">{error}</p> : null}<footer className="modal-actions"><button className="button button-quiet" onClick={onBack} disabled={posting}>Edit details</button><div className="balanced-seal"><i aria-hidden="true">✓</i><span>Ready<strong>Debit equals credit</strong></span></div><button className="button button-primary" onClick={onPost} disabled={posting}>{posting ? "Posting…" : "Approve & post"}<span aria-hidden="true">→</span></button></footer></div>;
}

function EntryDetail({ entry, onClose, onReverse }: { entry: PostedEntry; onClose: () => void; onReverse: (entry: PostedEntry, date: string) => Promise<PostedEntry> }) {
  const lines = deriveJournalLines(entry);
  const [reversing, setReversing] = useState(false); const [confirming, setConfirming] = useState(false); const [reversalDate, setReversalDate] = useState(todayISO); const [error, setError] = useState("");
  async function reverse() { setReversing(true); setError(""); try { await onReverse(entry, reversalDate); } catch (cause) { setError(cause instanceof Error ? cause.message : "The reversal could not be posted."); setReversing(false); } }
  return <ModalFrame label={`Entry ${entry.entryNumber}`} onClose={reversing ? undefined : onClose}><div className="entry-detail"><header><span className="status-posted">Posted</span><h2>{entry.description}</h2><p>{entry.entryNumber} · {formatDisplayDate(entry.date)}</p></header><dl><div><dt>Amount</dt><dd>{formatINR(entry.amountPaise)}</dd></div><div><dt>What it was</dt><dd>{transactionTypeLabel(entry.transactionType)} · {categoryLabel(entry.category)}</dd></div><div><dt>Where the money went</dt><dd>{settlementLabel(entry.settlement)}</dd></div><div><dt>Added by</dt><dd>{entry.createdBy}</dd></div><div><dt>Posted at</dt><dd>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))}</dd></div>{entry.reversalOf ? <div><dt>Corrects entry</dt><dd>{entry.reversalOf}</dd></div> : null}</dl><div className="review-journal"><header><span>Account</span><span>Debit</span><span>Credit</span></header>{lines.map((line) => <div key={line.account}><strong>{line.account}</strong><span>{line.debitPaise ? formatINR(line.debitPaise) : "—"}</span><span>{line.creditPaise ? formatINR(line.creditPaise) : "—"}</span></div>)}</div>{entry.transactionType !== "reversal" ? <section className="reversal-control">{confirming ? <><label>Correction date<input type="date" value={reversalDate} max={todayISO()} onChange={(event) => setReversalDate(event.target.value)} /></label><p>ACC will keep this entry and post equal-and-opposite lines linked to it. History is never overwritten.</p><div><button className="button button-quiet" onClick={() => setConfirming(false)} disabled={reversing}>Keep entry</button><button className="button button-danger" onClick={() => void reverse()} disabled={reversing}>{reversing ? "Posting reversal…" : "Post linked reversal"}</button></div></> : <button className="button button-secondary" onClick={() => setConfirming(true)}>Reverse this posted entry</button>}</section> : null}{error ? <p className="modal-error" role="alert">{error}</p> : null}</div></ModalFrame>;
}

function CompanyPanel({ config, onSignOut, hasPostedEntries, onEdit, onClose }: { config: WorkspaceConfig; onSignOut: () => void; hasPostedEntries: boolean; onEdit: (openingBalancesLocked: boolean) => void; onClose: () => void }) {
  return <ModalFrame label={`${config.businessName} workspace`} onClose={onClose}><div className="company-panel"><p className="eyebrow">WORKSPACE</p><h2>{config.businessName}</h2><p>{config.email ? `Contact: ${config.email}` : "Private workspace linked to this browser"}</p><dl><div><dt>Owner</dt><dd>{config.ownerName}</dd></div><div><dt>Financial year</dt><dd>{config.financialYear}</dd></div><div><dt>Opening bank cash</dt><dd>{formatINR(config.openingBankPaise)}</dd></div><div><dt>Opening cash in hand</dt><dd>{formatINR(config.cashInHandPaise)}</dd></div><div><dt>Opening capital</dt><dd>{formatINR(config.openingCapitalPaise)}</dd></div><div><dt>Opening balances</dt><dd>{hasPostedEntries ? "Locked after first post" : "Editable"}</dd></div><div><dt>Record source</dt><dd>Manual</dd></div></dl><div className="company-actions"><button className="button button-secondary" onClick={() => { onClose(); onEdit(hasPostedEntries); }}>Edit workspace</button><button className="button button-quiet" onClick={onSignOut}>Sign out</button></div></div></ModalFrame>;
}

// Kept as a compact deterministic fallback reference while persistent conversations use AskAccView.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AssistantPanel({ config, summary, onClose, onStart }: { config: WorkspaceConfig; summary: Summary; onClose: () => void; onStart: (type: TransactionType) => void }) {
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("Ask about an account, a business action, or what a number means. I’ll use the balances currently recorded in ACC.");
  const [dissolutionUnlocked, setDissolutionUnlocked] = useState(false);

  function respond(raw: string) {
    const query = raw.trim().toLowerCase();
    if (!query) return;
    const asksDissolution = /dissolv|close (my|the) business|shut (my|the) business|wind up|बंद|विघटन|समाप्त/.test(query);
    if (asksDissolution) {
      setDissolutionUnlocked(true);
      setAnswer(language === "hi" ? "मैंने व्यवसाय बंद करने की योजना खोल दी है। यह कोई स्वचालित बंदी या कानूनी फाइलिंग नहीं है—पहले सभी खाते मिलाएँ और अपने CA/कानूनी सलाहकार से पुष्टि करें।" : "I’ve opened the business-closure plan. Nothing has been dissolved or filed. Reconcile every account first, then confirm the legal and tax steps with your CA or legal adviser.");
    } else if (/bad debt|डूबत|वसूल नहीं/.test(query)) {
      setAnswer(language === "hi" ? `अभी ग्राहकों से लेना ${formatINR(summary.receivables.amountPaise)} है। केवल वही रकम Bad Debt में डालें जो सच में वसूल नहीं होगी; इससे Debtors और Profit दोनों घटेंगे।` : `Accounts Receivable is ${formatINR(summary.receivables.amountPaise)} now. Write off only a customer amount that is genuinely unrecoverable; it will reduce both receivables and profit.`);
    } else if (/provision|प्रावधान/.test(query)) {
      setAnswer(language === "hi" ? "Provision तब बनाइए जब आज की कोई वास्तविक जिम्मेदारी हो, भुगतान संभव हो और रकम का भरोसेमंद अनुमान लगाया जा सके। यह अभी cash नहीं घटाता, लेकिन liability और expense बढ़ाता है।" : "Create a provision only for a present obligation where payment is probable and the amount can be estimated reliably. It increases a liability and an expense now, but does not move cash now.");
    } else if (/reserve|रिजर्व/.test(query)) {
      setAnswer(language === "hi" ? `दर्ज reserves अभी ${formatINR(summary.reservesPaise)} हैं। Reserve transfer मौजूदा profit को अलग नाम देता है; यह नया profit या cash नहीं बनाता।` : `Recorded reserves are ${formatINR(summary.reservesPaise)}. A reserve transfer reclassifies existing retained profit; it does not create new profit or cash.`);
    } else if (/drawing|withdraw|personal use|निकाल|आहरण/.test(query)) {
      setAnswer(language === "hi" ? `दर्ज drawings ${formatINR(summary.drawingsPaise)} हैं। मालिक द्वारा निजी उपयोग के लिए निकाली गई रकम expense नहीं होती; यह capital घटाती है।` : `Recorded drawings are ${formatINR(summary.drawingsPaise)}. Money taken by an owner for personal use is not a business expense; it reduces owner equity.`);
    } else if (/capital|पूंजी/.test(query)) {
      setAnswer(language === "hi" ? `दर्ज owner capital ${formatINR(summary.capitalPaise)} है। नया capital डालने पर bank/cash और capital दोनों बढ़ते हैं; profit नहीं बदलता।` : `Recorded owner capital is ${formatINR(summary.capitalPaise)}. Introducing more capital increases bank or cash and owner capital by the same amount; profit does not change.`);
    } else if (/asset|investment|संपत्ति|निवेश/.test(query)) {
      setAnswer(language === "hi" ? `दर्ज assets कुल ${formatINR(summary.totalAssetsPaise)} हैं, जिनमें investments ${formatINR(summary.investmentsPaise)} हैं। Asset खरीदना सामान्य expense नहीं है; वह Balance Sheet में रहता है।` : `Recorded assets total ${formatINR(summary.totalAssetsPaise)}, including ${formatINR(summary.investmentsPaise)} of investments. Buying an asset does not automatically make it a day-to-day expense; it stays on the Balance Sheet.`);
    } else if (/liabil|loan|borrow|देनदारी|कर्ज|ऋण/.test(query)) {
      setAnswer(language === "hi" ? `दर्ज liabilities ${formatINR(summary.totalLiabilitiesPaise)} हैं, जिनमें loans/borrowings ${formatINR(summary.borrowingsPaise)} हैं। Loan मिलने पर cash और liability बढ़ते हैं; repayment पर दोनों घटते हैं।` : `Recorded liabilities total ${formatINR(summary.totalLiabilitiesPaise)}, including ${formatINR(summary.borrowingsPaise)} of loans and borrowings. Receiving a loan increases cash and liability; repayment reduces both.`);
    } else if (/balance sheet|बैलेंस/.test(query)) {
      setAnswer(summary.balanceSheetReady ? (language === "hi" ? `Balance Sheet संतुलित है: assets ${formatINR(summary.totalAssetsPaise)} और liabilities plus capital ${formatINR(summary.totalLiabilitiesPaise + (summary.equityPaise ?? 0))} हैं।` : `The Balance Sheet is balanced: assets are ${formatINR(summary.totalAssetsPaise)} and liabilities plus capital are ${formatINR(summary.totalLiabilitiesPaise + (summary.equityPaise ?? 0))}.`) : (language === "hi" ? `Opening difference ${formatINR(Math.abs(summary.balanceSheetDifferencePaise))} है। Opening cash के सामने उतना capital या liability दर्ज करें—कोई अनुमान नहीं लगाया गया है।` : `The exact opening difference is ${formatINR(Math.abs(summary.balanceSheetDifferencePaise))}. Record the matching opening capital or actual liability; ACC has not guessed the source.`));
    } else {
      setAnswer(language === "hi" ? "इसे दर्ज करने के लिए पहले तय करें: क्या यह income, expense, capital, asset, liability, drawing, bad debt, provision या reserve है? नीचे सही action चुनें; पोस्ट करने से पहले debit और credit दिखेंगे।" : "First classify it as income, expense, capital, an asset, a liability, drawings, bad debt, a provision, or a reserve. Choose the matching action below; ACC will show both debit and credit before posting.");
    }
    setQuestion("");
  }

  return <aside className="assistant-panel glass-panel" role="dialog" aria-modal="true" aria-label="ACC accounting assistant"><header><div><span className="assistant-mark">A</span><div><strong>Ask ACC</strong><small>Guided accounting assistant</small></div></div><button onClick={onClose} aria-label="Close assistant">×</button></header><div className="assistant-language"><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button><button className={language === "hi" ? "active" : ""} onClick={() => setLanguage("hi")}>हिन्दी</button></div><div className="assistant-answer"><span>ACC</span><p>{answer}</p></div><div className="assistant-prompts"><button onClick={() => respond("Explain my capital")}>Explain capital</button><button onClick={() => respond("What are my liabilities?")}>My liabilities</button><button onClick={() => respond("What is bad debt?")}>Bad debt</button><button onClick={() => respond("How do I dissolve my business?")}>Close business</button></div><form onSubmit={(event) => { event.preventDefault(); respond(question); }}><label htmlFor="assistant-question">Ask in everyday words</label><div><input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={language === "hi" ? "जैसे: पूंजी कैसे डालें?" : "For example: How do I add capital?"} autoFocus /><button type="submit">↑</button></div></form><section className="assistant-actions"><span>Start an entry</span><div><button onClick={() => onStart("capital_in")}>Capital</button><button onClick={() => onStart("asset_purchase")}>Asset</button><button onClick={() => onStart("liability_borrow")}>Liability</button><button onClick={() => onStart("drawings")}>Drawings</button></div></section>{dissolutionUnlocked ? <section className="dissolution-guide"><span>UNLOCKED · BUSINESS CLOSURE PLAN</span><h3>Prepare before any filing.</h3><ol><li>Reconcile bank, cash, receivables, payables, assets, loans, capital and taxes.</li><li>Collect receivables and record bad debts only with evidence.</li><li>Realise or transfer assets and record the actual amounts.</li><li>Settle outside liabilities, then partner advances and partner capital in the legally applicable order.</li><li>Distribute any residue only after claims and closure costs are confirmed.</li><li>Ask a CA or legal adviser about GST, income tax, registrations and entity-specific filings.</li></ol><p>Nothing here closes {config.businessName}. It is a preparation checklist, not legal or tax advice.</p></section> : null}<footer>Answers use your current ACC balances and a fixed accounting guide. Confirm tax, audit and legal decisions with a qualified professional.</footer></aside>;
}

function ModalFrame({ label, onClose, wide = false, children }: { label: string; onClose?: () => void; wide?: boolean; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    frame.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]")?.focus();
    return () => returnFocus.current?.focus();
  }, []);
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && onClose) { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab" || !frame.current) return;
    const focusable = [...frame.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]")];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && onClose) onClose(); }}><div className={`glass-modal${wide ? " wide" : ""}`} ref={frame} role="dialog" aria-modal="true" aria-label={label} onKeyDown={handleKey}>{onClose ? <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button> : null}{children}</div></div>;
}
