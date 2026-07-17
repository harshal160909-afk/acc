import { providerRegistry } from "@/app/lib/ai/providers";

function safePublicValue(value: string | undefined, max = 160) {
  const text = value?.trim() ?? "";
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

export async function GET() {
  try {
    const [{ env }, registry] = await Promise.all([import("cloudflare:workers"), providerRegistry()]);
    const health = await Promise.all([
      registry.providers.openai.healthCheck(),
      registry.providers.nvidia.healthCheck(),
    ]);
    return Response.json({
      ai: {
        defaultProvider: registry.config.defaultProvider,
        fallbackProvider: registry.config.fallbackProvider,
        providers: health,
      },
      marketData: {
        configured: Boolean(env.MARKET_DATA_PROVIDER?.trim() && env.MARKET_DATA_API_KEY?.trim() && env.MARKET_DATA_BASE_URL?.trim()),
        provider: safePublicValue(env.MARKET_DATA_PROVIDER, 60),
        status: env.MARKET_DATA_PROVIDER?.trim() && env.MARKET_DATA_API_KEY?.trim() && env.MARKET_DATA_BASE_URL?.trim()
          ? "configured"
          : "configuration_required",
        message: env.MARKET_DATA_PROVIDER?.trim() && env.MARKET_DATA_API_KEY?.trim() && env.MARKET_DATA_BASE_URL?.trim()
          ? "A licensed server-side market source is configured."
          : "No licensed market source is configured. Manual prices remain available and clearly labelled.",
      },
      contact: {
        phone: safePublicValue(env.NEXT_PUBLIC_SUPPORT_PHONE_E164, 30),
        whatsapp: safePublicValue(env.NEXT_PUBLIC_WHATSAPP_NUMBER, 30),
        email: safePublicValue(env.NEXT_PUBLIC_SUPPORT_EMAIL, 160),
        instagram: safePublicValue(env.NEXT_PUBLIC_INSTAGRAM_HANDLE, 80),
      },
      checkedAt: Date.now(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Service configuration status is unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
