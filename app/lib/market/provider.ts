export type LicensedQuote = {
  pricePaise: number;
  currency: string;
  observedAt: number;
  retrievedAt: number;
  delayMinutes: number;
  licensingStatus: string;
  source: string;
};

type MarketConfig = { configured: boolean; provider: string; baseUrl: string; apiKey: string; defaultDelayMinutes: number };

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export async function readMarketConfig(): Promise<MarketConfig> {
  const { env } = await import("cloudflare:workers");
  const provider = env.MARKET_DATA_PROVIDER?.trim() ?? "";
  const baseUrl = env.MARKET_DATA_BASE_URL?.trim() ?? "";
  const apiKey = env.MARKET_DATA_API_KEY?.trim() ?? "";
  return { configured: Boolean(provider && baseUrl && apiKey), provider, baseUrl, apiKey, defaultDelayMinutes: boundedInteger(env.MARKET_DATA_DEFAULT_DELAY_MINUTES, 15, 0, 1440) };
}

function observedTime(value: unknown, retrievedAt: number) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= retrievedAt) return value;
  if (typeof value === "string") { const parsed = Date.parse(value); if (Number.isFinite(parsed) && parsed > 0 && parsed <= retrievedAt) return parsed; }
  return null;
}

export async function fetchLicensedQuote(symbol: string, exchange: string): Promise<LicensedQuote> {
  const config = await readMarketConfig();
  if (!config.configured) throw new Error("Licensed market data configuration is required");
  const url = new URL(config.baseUrl); url.searchParams.set("symbol", symbol); url.searchParams.set("exchange", exchange);
  const retrievedAt = Date.now();
  const response = await fetch(url, { headers: { authorization: `Bearer ${config.apiKey}`, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Market provider returned HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const pricePaise = payload.pricePaise;
  const observedAt = observedTime(payload.observedAt, retrievedAt);
  if (typeof pricePaise !== "number" || !Number.isSafeInteger(pricePaise) || pricePaise <= 0 || observedAt === null) throw new Error("Market provider response did not match ACC's exact quote contract");
  const delayMinutes = typeof payload.delayMinutes === "number" && Number.isSafeInteger(payload.delayMinutes) && payload.delayMinutes >= 0 && payload.delayMinutes <= 1440 ? payload.delayMinutes : config.defaultDelayMinutes;
  const currency = typeof payload.currency === "string" && /^[A-Z]{3}$/.test(payload.currency) ? payload.currency : "INR";
  const licensingStatus = typeof payload.licensingStatus === "string" && payload.licensingStatus.trim() ? payload.licensingStatus.trim().slice(0, 80) : "configured_provider";
  return { pricePaise, currency, observedAt, retrievedAt, delayMinutes, licensingStatus, source: `provider:${config.provider.slice(0, 60)}` };
}
