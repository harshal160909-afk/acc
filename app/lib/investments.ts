export const QUANTITY_SCALE = 1_000_000;

export type InvestmentTransactionType =
  | "buy" | "sell" | "dividend" | "interest"
  | "deposit" | "withdrawal" | "fee" | "tax" | "adjustment";

export function parseQuantityMicros(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const micros = BigInt(whole) * BigInt(QUANTITY_SCALE) + BigInt(fraction.padEnd(6, "0"));
  return micros > BigInt(0) && micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
}

export function formatQuantityMicros(micros: number) {
  if (!Number.isSafeInteger(micros)) return "—";
  const whole = Math.trunc(micros / QUANTITY_SCALE);
  const fraction = String(Math.abs(micros % QUANTITY_SCALE)).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function multiplyPriceByQuantity(pricePaise: number, quantityMicros: number) {
  if (!Number.isSafeInteger(pricePaise) || !Number.isSafeInteger(quantityMicros)) return null;
  const numerator = BigInt(pricePaise) * BigInt(quantityMicros);
  const value = (numerator + BigInt(QUANTITY_SCALE / 2)) / BigInt(QUANTITY_SCALE);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : null;
}

export function investmentCashEffect(
  type: InvestmentTransactionType,
  amountPaise: number,
  feesPaise: number,
  taxesPaise: number,
) {
  const costs = feesPaise + taxesPaise;
  if (type === "buy") return -(amountPaise + costs);
  if (type === "sell") return amountPaise - costs;
  if (type === "deposit" || type === "dividend" || type === "interest") return amountPaise;
  if (type === "withdrawal" || type === "fee" || type === "tax") return -amountPaise;
  return 0;
}

// ---------------------------------------------------------------------------
// Cost basis and gain calculations (weighted average).
//
// Methodology (surfaced to the user as METHODOLOGY):
//  - Cost basis uses the *weighted-average* method. A buy adds its full cost
//    (amount + fees + taxes) to the position's cost pool. A sell removes cost
//    in proportion to the units sold (costRemoved = costPool * unitsSold /
//    unitsHeld), booking realized gain = net proceeds (amount − fees − taxes)
//    − costRemoved.
//  - Unrealized gain = current market value − remaining cost basis, and is only
//    reported when a price exists for every held security ("complete").
//  - All arithmetic is exact integer paise; proportional cost removal is done in
//    BigInt and rounded half-up.
//  - XIRR is reported only when it is mathematically valid: at least one cash
//    contribution and one positive terminal/withdrawal flow spanning ≥ 2 dates,
//    and the solver converges to a rate in a sane range. Otherwise it is null.
// ---------------------------------------------------------------------------

export type InvestmentTxInput = {
  transactionType: InvestmentTransactionType;
  tradeDate: string;
  securityId: string | null;
  quantityMicros: number | null;
  amountPaise: number;
  feesPaise: number;
  taxesPaise: number;
};

export type HoldingBasis = {
  securityId: string;
  quantityMicros: number;
  costBasisPaise: number;
};

export type PortfolioAnalytics = {
  cashContributedPaise: number;
  cashWithdrawnPaise: number;
  netExternalCashFlowPaise: number;
  dividendsInterestPaise: number;
  feesTaxesPaise: number;
  realizedGainPaise: number;
  costBasisPaise: number;
  holdingsValuePaise: number | null;
  unrealizedGainPaise: number | null;
  totalValuePaise: number | null;
  valuationStatus: "complete" | "missing_prices" | "cash_only";
  xirrBps: number | null;
  xirrUnavailableReason: string | null;
  basisBySecurity: Record<string, HoldingBasis>;
};

function roundedShare(pool: bigint, part: bigint, whole: bigint): bigint {
  if (whole <= BigInt(0)) return BigInt(0);
  const numerator = pool * part;
  return (numerator + whole / BigInt(2)) / whole;
}

/**
 * Compute weighted-average cost basis, realized gain and (when every held
 * security has a price) unrealized gain and XIRR for one portfolio.
 * `transactions` must be ordered oldest-first. `priceBySecurity` maps a
 * security id to its latest price in paise, or is absent when unavailable.
 */
export function computePortfolioAnalytics(
  transactions: InvestmentTxInput[],
  priceBySecurity: Map<string, number>,
): PortfolioAnalytics {
  const basis = new Map<string, { quantityMicros: number; costPaise: number }>();
  let cashContributed = 0;
  let cashWithdrawn = 0;
  let dividendsInterest = 0;
  let feesTaxes = 0;
  let realized = 0;
  let cashPaise = 0;

  for (const tx of transactions) {
    feesTaxes += tx.feesPaise + tx.taxesPaise;
    cashPaise += investmentCashEffect(tx.transactionType, tx.amountPaise, tx.feesPaise, tx.taxesPaise);
    if (tx.transactionType === "deposit") cashContributed += tx.amountPaise;
    else if (tx.transactionType === "withdrawal") cashWithdrawn += tx.amountPaise;
    else if (tx.transactionType === "dividend" || tx.transactionType === "interest") dividendsInterest += tx.amountPaise;

    if (!tx.securityId || tx.quantityMicros === null) continue;
    const lot = basis.get(tx.securityId) ?? { quantityMicros: 0, costPaise: 0 };
    if (tx.transactionType === "buy") {
      lot.quantityMicros += tx.quantityMicros;
      lot.costPaise += tx.amountPaise + tx.feesPaise + tx.taxesPaise;
    } else if (tx.transactionType === "sell") {
      const soldMicros = Math.min(tx.quantityMicros, lot.quantityMicros);
      const costRemoved = Number(roundedShare(BigInt(lot.costPaise), BigInt(soldMicros), BigInt(lot.quantityMicros || 1)));
      const netProceeds = tx.amountPaise - tx.feesPaise - tx.taxesPaise;
      realized += netProceeds - costRemoved;
      lot.quantityMicros -= soldMicros;
      lot.costPaise -= costRemoved;
      if (lot.quantityMicros <= 0) { lot.quantityMicros = 0; lot.costPaise = 0; }
    }
    basis.set(tx.securityId, lot);
  }

  const basisBySecurity: Record<string, HoldingBasis> = {};
  let costBasisPaise = 0;
  let holdingsValuePaise = 0;
  let anyHolding = false;
  let allPriced = true;
  for (const [securityId, lot] of basis) {
    if (lot.quantityMicros === 0) continue;
    anyHolding = true;
    costBasisPaise += lot.costPaise;
    basisBySecurity[securityId] = { securityId, quantityMicros: lot.quantityMicros, costBasisPaise: lot.costPaise };
    const price = priceBySecurity.get(securityId);
    const value = price !== undefined ? multiplyPriceByQuantity(price, lot.quantityMicros) : null;
    if (value === null) allPriced = false;
    else holdingsValuePaise += value;
  }

  const valuationStatus: PortfolioAnalytics["valuationStatus"] = !anyHolding ? "cash_only" : allPriced ? "complete" : "missing_prices";
  const holdings = anyHolding && allPriced ? holdingsValuePaise : null;
  const unrealized = holdings === null ? null : holdings - costBasisPaise;
  const totalValue = holdings === null ? (anyHolding ? null : cashPaise) : cashPaise + holdings;

  const xirr = totalValue === null
    ? { bps: null, reason: "Total value is unavailable until every holding has a price." }
    : computeXirrBps(transactions, totalValue);

  return {
    cashContributedPaise: cashContributed,
    cashWithdrawnPaise: cashWithdrawn,
    netExternalCashFlowPaise: cashContributed - cashWithdrawn,
    dividendsInterestPaise: dividendsInterest,
    feesTaxesPaise: feesTaxes,
    realizedGainPaise: realized,
    costBasisPaise,
    holdingsValuePaise: holdings,
    unrealizedGainPaise: unrealized,
    totalValuePaise: totalValue,
    valuationStatus,
    xirrBps: xirr.bps,
    xirrUnavailableReason: xirr.bps === null ? xirr.reason : null,
    basisBySecurity,
  };
}

function dayNumber(date: string): number | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}

/**
 * Annualized money-weighted return (XIRR) in basis points, or null when it is
 * not mathematically valid. External flows only: deposits are money in
 * (negative), withdrawals are money out (positive), and the current total value
 * is a positive terminal flow today.
 */
export function computeXirrBps(
  transactions: InvestmentTxInput[],
  totalValuePaise: number,
): { bps: number | null; reason: string } {
  const flows: Array<{ day: number; amount: number }> = [];
  let lastDay = -Infinity;
  for (const tx of transactions) {
    const day = dayNumber(tx.tradeDate);
    if (day === null) continue;
    lastDay = Math.max(lastDay, day);
    if (tx.transactionType === "deposit") flows.push({ day, amount: -tx.amountPaise });
    else if (tx.transactionType === "withdrawal") flows.push({ day, amount: tx.amountPaise });
  }
  if (!flows.length) return { bps: null, reason: "Add a portfolio deposit to measure an annualized return." };
  const terminalDay = Math.max(lastDay, dayNumber(new Date().toISOString().slice(0, 10)) ?? lastDay);
  flows.push({ day: terminalDay, amount: totalValuePaise });

  const hasNegative = flows.some((f) => f.amount < 0);
  const hasPositive = flows.some((f) => f.amount > 0);
  const spanDays = Math.max(...flows.map((f) => f.day)) - Math.min(...flows.map((f) => f.day));
  if (!hasNegative || !hasPositive) return { bps: null, reason: "Both a contribution and a positive value are needed." };
  if (spanDays < 1) return { bps: null, reason: "At least one day must pass between contribution and valuation." };

  const base = Math.min(...flows.map((f) => f.day));
  const npv = (rate: number) => flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + rate, (f.day - base) / 365), 0);

  // Bisection over an annual rate in (-99%, +1000%) — robust and always bounded.
  let low = -0.99;
  let high = 10;
  const npvLow = npv(low);
  const npvHigh = npv(high);
  if (npvLow === 0) return { bps: Math.round(low * 10_000), reason: "" };
  if (npvHigh === 0) return { bps: Math.round(high * 10_000), reason: "" };
  if (npvLow * npvHigh > 0) return { bps: null, reason: "A single annualized rate does not fit these cash flows yet." };
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < 1) return { bps: Math.round(mid * 10_000), reason: "" };
    if (npvLow * value < 0) high = mid; else low = mid;
  }
  return { bps: Math.round(((low + high) / 2) * 10_000), reason: "" };
}
