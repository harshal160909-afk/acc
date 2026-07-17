"use client";

import { useMemo, useState } from "react";
import { calculateFinancialSummary, deriveJournalLines, formatDisplayDate, transactionTypeLabel } from "../lib/finance";
import { formatINR } from "../lib/money";
import type { PostedEntry, WorkspaceConfig } from "./types";

type Summary = ReturnType<typeof calculateFinancialSummary>;

function monthKey(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function monthEnd(key: string) { const [year, month] = key.split("-").map(Number); return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); }
function cashEffect(entry: PostedEntry) { return deriveJournalLines(entry).filter((line) => line.account === "Bank" || line.account === "Cash in Hand").reduce((sum, line) => sum + line.debitPaise - line.creditPaise, 0); }
function revenueEffect(entry: PostedEntry) { return deriveJournalLines(entry).filter((line) => line.account.endsWith("Revenue") || line.account === "Sales Returns").reduce((sum, line) => sum + line.creditPaise - line.debitPaise, 0); }
function expenseEffect(entry: PostedEntry) { return deriveJournalLines(entry).filter((line) => line.account.endsWith("Expense") || line.account === "Bad Debts Expense" || line.account === "Cost of Goods Sold").reduce((sum, line) => sum + line.debitPaise - line.creditPaise, 0); }

function FlowNode({ label, amount, tone, onClick }: { label: string; amount: number; tone: string; onClick: () => void }) {
  return <button className={`pulse-node ${tone}`} onClick={onClick}><i aria-hidden="true" /><strong>{label}</strong><span>{formatINR(amount)}</span></button>;
}

export function PulseView({ config, entries, summary, onEntry, onBooks }: { config: WorkspaceConfig; entries: PostedEntry[]; summary: Summary; onEntry: (entry: PostedEntry) => void; onBooks: () => void }) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [flowDetail, setFlowDetail] = useState<"revenue" | "expenses" | "cash" | "assets" | "liabilities" | "capital" | null>(null);
  const months = useMemo(() => {
    const asOf = new Date(`${summary.asOfDate ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (5 - index), 1));
      const key = monthKey(date); const end = monthEnd(key); const rows = entries.filter((entry) => entry.date.slice(0, 7) === key);
      const cashIn = rows.reduce((sum, entry) => sum + Math.max(0, cashEffect(entry)), 0);
      const cashOut = rows.reduce((sum, entry) => sum + Math.max(0, -cashEffect(entry)), 0);
      const closingCash = config.openingBankPaise + config.cashInHandPaise + entries.filter((entry) => entry.date <= end).reduce((sum, entry) => sum + cashEffect(entry), 0);
      return { key, label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(date), end, rows, cashIn, cashOut, closingCash };
    });
  }, [config.cashInHandPaise, config.openingBankPaise, entries, summary.asOfDate]);
  const maxFlow = Math.max(1, ...months.flatMap((month) => [month.cashIn, month.cashOut]));
  const cashMin = Math.min(...months.map((month) => month.closingCash)); const cashMax = Math.max(...months.map((month) => month.closingCash)); const cashRange = Math.max(1, cashMax - cashMin);
  const profitPaise = summary.profit?.amountPaise ?? null;
  const profitPerHundred = summary.revenue.amountPaise > 0 && profitPaise !== null ? Math.round((profitPaise / summary.revenue.amountPaise) * 100) : null;
  const selected = selectedMonth ? months.find((month) => month.key === selectedMonth) : null;
  const detailEntries = flowDetail ? entries.filter((entry) => {
    if (flowDetail === "revenue") return revenueEffect(entry) !== 0;
    if (flowDetail === "expenses") return expenseEffect(entry) !== 0;
    if (flowDetail === "cash") return cashEffect(entry) !== 0;
    if (flowDetail === "capital") return entry.transactionType === "capital_in" || entry.transactionType === "drawings" || entry.transactionType === "reserve_transfer";
    if (flowDetail === "liabilities") return entry.transactionType === "liability_borrow" || entry.transactionType === "liability_repay" || entry.transactionType === "provision_create";
    return entry.transactionType === "asset_purchase" || entry.transactionType === "investment_purchase";
  }) : [];

  if (!summary.hasTransactionHistory && config.openingBankPaise === 0 && config.cashInHandPaise === 0 && config.openingCapitalPaise === 0) {
    return <section className="pulse-empty glass-panel"><span>ACC PULSE</span><h1>Your business picture starts with a real record.</h1><p>Add an opening balance or post your first transaction. Until then, ACC will not draw a chart or claim a trend.</p><button className="button button-primary" onClick={onBooks}>Open Books</button></section>;
  }

  return <div className="pulse-view">
    <header className="view-heading"><div><span>ACC PULSE · {summary.asOfDate ? `AS OF ${formatDisplayDate(summary.asOfDate)}` : "CURRENT RECORDS"}</span><h1>Your business, seen clearly.</h1><p>Every shape below is calculated from your opening balances and posted Journal entries.</p></div><button className="button button-secondary" onClick={onBooks}>Open exact books</button></header>
    <section className="pulse-hero glass-panel"><div><span>AVAILABLE CASH</span><strong>{formatINR(summary.availableCash.amountPaise)}</strong><p>Bank {formatINR(summary.cashAtBank.amountPaise)} · Cash in hand {formatINR(summary.cashInHand.amountPaise)}</p></div><div className="cash-line" role="img" aria-label="Six month closing cash history">{months.map((month) => { const bottom = 12 + ((month.closingCash - cashMin) / cashRange) * 70; return <button key={month.key} className={selectedMonth === month.key ? "active" : ""} style={{ "--point": `${bottom}%` } as React.CSSProperties} onClick={() => setSelectedMonth(month.key === selectedMonth ? null : month.key)} title={`${month.label}: ${formatINR(month.closingCash)}`}><i /><span>{month.label}</span></button>; })}</div>{selected ? <div className="pulse-popover"><strong>{selected.label} closing cash</strong><span>{formatINR(selected.closingCash)}</span><small>{selected.rows.length} posted {selected.rows.length === 1 ? "record" : "records"}</small></div> : null}</section>
    <div className="pulse-grid">
      <section className="pulse-card glass-panel"><header><span>MONEY IN VS MONEY OUT</span><strong>{summary.cashInflowsPaise >= summary.cashOutflowsPaise ? "More came in than went out." : "More went out than came in."}</strong></header><div className="cash-bars">{months.map((month) => <button key={month.key} onClick={() => setSelectedMonth(month.key)} title={`${month.label}: in ${formatINR(month.cashIn)}, out ${formatINR(month.cashOut)}`}><i className="in" style={{ height: `${Math.max(month.cashIn ? 6 : 0, (month.cashIn / maxFlow) * 100)}%` }} /><i className="out" style={{ height: `${Math.max(month.cashOut ? 6 : 0, (month.cashOut / maxFlow) * 100)}%` }} /><span>{month.label}</span></button>)}</div><footer><span><i className="in" />Money in {formatINR(summary.cashInflowsPaise)}</span><span><i className="out" />Money out {formatINR(summary.cashOutflowsPaise)}</span></footer></section>
      <section className="pulse-card profit-card glass-panel"><header><span>FOR EVERY ₹100 EARNED</span>{profitPerHundred === null ? <strong>No revenue has been posted for this period.</strong> : <strong>{profitPerHundred >= 0 ? `₹${profitPerHundred} remained after recorded costs.` : `Recorded costs exceeded revenue by ₹${Math.abs(profitPerHundred)}.`}</strong>}</header>{profitPerHundred === null ? <div className="profit-empty">No ratio is shown without recorded revenue.</div> : <div className="profit-ring" style={{ "--kept": `${Math.max(0, Math.min(100, profitPerHundred)) * 3.6}deg` } as React.CSSProperties}><div><strong>{profitPerHundred}%</strong><span>{profitPerHundred >= 0 ? "kept" : "loss"}</span></div></div>}<dl><div><dt>Revenue</dt><dd>{formatINR(summary.revenue.amountPaise)}</dd></div><div><dt>Recorded costs</dt><dd>{formatINR(summary.expenses.amountPaise)}</dd></div><div><dt>Profit / loss</dt><dd>{profitPaise === null ? "Unavailable" : formatINR(profitPaise)}</dd></div></dl></section>
    </div>
    <section className="money-chain glass-panel"><header><span>SOURCE → ACCOUNTS → EFFECT</span><h2>Follow the money.</h2><p>Select a node to see only the entries that created it.</p></header><div className="chain-map"><FlowNode label="Revenue" amount={summary.revenue.amountPaise} tone="green" onClick={() => setFlowDetail("revenue")} /><i aria-hidden="true" /><FlowNode label="Cash" amount={summary.availableCash.amountPaise} tone="ivory" onClick={() => setFlowDetail("cash")} /><i aria-hidden="true" /><FlowNode label="Assets" amount={summary.totalAssetsPaise} tone="brass" onClick={() => setFlowDetail("assets")} /><i aria-hidden="true" /><FlowNode label="Liabilities" amount={summary.totalLiabilitiesPaise} tone="oxblood" onClick={() => setFlowDetail("liabilities")} /><i aria-hidden="true" /><FlowNode label="Capital" amount={summary.capitalPaise} tone="charcoal" onClick={() => setFlowDetail("capital")} /></div></section>
    {flowDetail ? <aside className="pulse-detail glass-panel"><header><div><span>POSTED RECORDS</span><strong>{flowDetail[0].toUpperCase() + flowDetail.slice(1)}</strong></div><button onClick={() => setFlowDetail(null)} aria-label="Close detail">×</button></header>{detailEntries.length ? <div>{detailEntries.slice().reverse().map((entry) => <button key={entry.id} onClick={() => onEntry(entry)}><span><strong>{entry.description}</strong><small>{formatDisplayDate(entry.date)} · {transactionTypeLabel(entry.transactionType)}</small></span><b>{formatINR(entry.amountPaise)}</b></button>)}</div> : <p>No posted Journal entry affects this area yet.</p>}</aside> : null}
  </div>;
}
