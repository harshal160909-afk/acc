declare module "cloudflare:workers" {
  type D1Result<T = unknown> = {
    results: T[];
    success: boolean;
  };

  type D1PreparedStatement = {
    bind: (...values: unknown[]) => D1PreparedStatement;
    run: () => Promise<D1Result>;
    all: <T = unknown>() => Promise<D1Result<T>>;
  };

  type D1Database = {
    prepare: (query: string) => D1PreparedStatement;
  };

  export const env: {
    DB?: D1Database;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    NVIDIA_API_KEY?: string;
    NVIDIA_MODEL?: string;
    NVIDIA_BASE_URL?: string;
    AI_DEFAULT_PROVIDER?: string;
    AI_FALLBACK_PROVIDER?: string;
    AI_REQUEST_TIMEOUT_MS?: string;
    AI_MAX_TOOL_STEPS?: string;
    AI_ENABLE_MARKET_NEWS?: string;
    MARKET_DATA_PROVIDER?: string;
    MARKET_DATA_API_KEY?: string;
    MARKET_DATA_BASE_URL?: string;
    MARKET_DATA_DEFAULT_DELAY_MINUTES?: string;
    NEXT_PUBLIC_SUPPORT_PHONE_E164?: string;
    NEXT_PUBLIC_WHATSAPP_NUMBER?: string;
    NEXT_PUBLIC_SUPPORT_EMAIL?: string;
    NEXT_PUBLIC_INSTAGRAM_HANDLE?: string;
  };
}
