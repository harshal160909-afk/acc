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
