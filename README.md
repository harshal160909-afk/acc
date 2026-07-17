# ACC

ACC is an AI-assisted accounting workspace for Indian businesses. A user describes a business event in everyday language, reviews the exact double-entry proposal, and explicitly approves it before it reaches the Journal. One verified record then feeds the Ledger, Trial Balance, Profit & Loss, Balance Sheet, Cash Movement, ACC Pulse, and controlled Ask ACC calculations.

## Release scope

- Google OAuth 2.0 / OpenID Connect with PKCE, state, nonce, signed-token verification, immutable internal user IDs, hashed server sessions, and sign-out revocation
- strict owner/workspace isolation for businesses, books, conversations, portfolios, manual prices, market research, support requests, export, and deletion
- paise-safe Indian amounts, lakh/crore and quantity × unit-price extraction, cheque/UPI/bank/credit settlement, additive GST, partial payment, customer collection, supplier payment, advances, returns, depreciation, GST/TDS payment, bad debts, provisions, reserves, and linked reversals
- deterministic accounting validation: AI drafts → rules validation → user review → explicit approval → one atomic post
- Journal, Ledger, Trial Balance, P&L, Balance Sheet, Cash Movement, Chart of Accounts, audit trail, and period-lock enforcement
- persistent Ask ACC conversations with streaming, cancellation, context-specific read-only tools, and provider configuration states
- owner-scoped investment portfolios, decimal-safe quantities, cost records, user-entered price provenance, licensed-price adapter, and an honest missing-price state
- Market Research Beta with guided profiles, official Reddit/YouTube adapters behind compliance gates, provenance, cleaning, clustering, transparent scoring, evidence inspection, experiments, and no guaranteed forecasts
- complete owner-scoped JSON export and typed-confirmation atomic account deletion
- CSP, same-origin mutation protection, restricted preflight handling, rate limits, safe provider timeouts, and security headers

ACC does not execute trades, submit taxes, close a legal entity, or post an AI draft without approval. Quotes, external research, and conversational AI stay visibly unavailable until their approved providers are configured.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Copy `.env.example` into the environment mechanism supported by the runtime. Never commit real credentials.

## Google sign-in

Configure these server-side values:

```text
APP_BASE_URL=https://the-exact-public-origin.example
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Register this exact redirect URI in Google Cloud:

```text
https://the-exact-public-origin.example/auth/google/callback
```

`APP_BASE_URL` must use HTTPS and contain no path. If the credentials are absent, the public page shows an honest configuration-required state and the private workspace remains locked.

## AI providers

OpenAI requires `OPENAI_API_KEY` and `OPENAI_MODEL`. The server uses the Responses API and does not hardcode a model. NVIDIA fallback requires `NVIDIA_API_KEY`, `NVIDIA_MODEL`, and `NVIDIA_BASE_URL`.

Deterministic transaction drafting and controlled accounting calculations do not require a conversational provider. Without a configured provider, general Ask ACC explanations show a configuration-required message; no financial record is invented.

## Market and investment data

Manual investment records work without an external API. Licensed quotes require `MARKET_DATA_PROVIDER`, `MARKET_DATA_API_KEY`, and `MARKET_DATA_BASE_URL`. The adapter expects positive integer `pricePaise`, a real observation time, currency, delay, and licensing status. User-entered prices are stored separately by owner and workspace, so one user can never change another user’s valuation.

Market Research Beta collects only from configured, permitted sources. Reddit requires official API credentials plus `REDDIT_COMMERCIAL_APPROVAL=true`; YouTube requires an API key plus `YOUTUBE_COMPLIANCE_APPROVED=true`. Missing or failed sources stay unavailable. Research is currently on-demand, not a background monitoring promise.

## Database and migrations

All schema changes live in additive Drizzle migrations under `drizzle/`. Application requests never create or alter tables.

```bash
npm run db:generate
```

Apply migrations in order before routing production traffic. Financial multi-write operations require D1 `batch()` so a failed statement rolls back the whole batch. The release contains schema foundations for bank-statement reconciliation, inventory records, fixed assets, depreciation, and period locks; provider-specific import workflows should remain disabled until their validation UI is implemented.

Before deployment, confirm D1 Time Travel/restore is enabled for the account, record the database ID, and rehearse recovery in a non-production environment. A rollback of application code must not reverse an already-applied additive migration.

## Verification gate

```bash
npm run typecheck
npm run lint
npm test
npm audit --omit=dev
```

The acceptance suite covers exact money, zero-data truthfulness, report reconciliation, owner/auth boundaries, spoofed-header rejection, transaction parsing, collections/payments/returns/GST, deterministic revalidation, atomic approval/reversal wiring, manual-price isolation, portfolio redirect, export/deletion, market evidence gates, responsive visual requirements, and fabricated-data scans.

## Deployment checklist

1. Apply every checked-in D1 migration.
2. Set `APP_BASE_URL`, Google OAuth credentials, and only the approved optional providers.
3. Register the exact Google callback for the final domain.
4. Run the full verification gate.
5. Publish and test sign-in, onboarding, draft/approve/post, reversal, export, deletion in a disposable account, portfolio creation, and provider-failure states.
6. Verify CSP/security headers and mobile/desktop layouts on the public origin.
7. Keep the earlier version available for application rollback and use D1 recovery only for an actual data-recovery event.

## Privacy and operational limits

- Complete accounting records are not sent to market-source providers.
- Ask ACC receives controlled tool results; it cannot directly post entries or execute trades.
- Public-source research never accesses private messages, private accounts, deleted content, or prohibited communities.
- Forecasting remains disabled until sufficient real history, independent sources, stable collection, acceptable missing data, and backtesting exist.
- Accounting, tax, legal, privacy, provider licensing, retention, and incident-response policies still require qualified human review before a regulated production launch.
