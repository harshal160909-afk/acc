# ACC

ACC is an AI-assisted accounting workspace for Indian businesses. It opens for everyone — no sign-up, no password, no Google account. A visitor describes a business event in everyday language, reviews the exact double-entry proposal, and explicitly approves it before it reaches the Journal. One verified record then feeds the Ledger, Trial Balance, Profit & Loss, Balance Sheet, Cash Movement, ACC Pulse, and controlled Ask ACC calculations.

## Release scope

- **Anonymous guest access:** each visitor gets an isolated private workspace keyed to an immutable internal user ID (UUID). A cryptographically random session token is issued; only its SHA-256 hash is stored in D1, and the raw token lives in an HttpOnly/Secure cookie. Sessions rotate and are revoked on sign-out. Email is optional contact information only — it never controls access. See `docs/GUEST-DATA-RETENTION.md`.
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

## Access model (anonymous guest sessions)

There is **no Google login and no login provider to configure.** The public front door is:

```text
POST /api/session/bootstrap   # idempotent, rate-limited; restores or creates a guest workspace
POST /api/session/signout     # revokes the session server-side and clears the cookie
```

The landing page shows a single **“Open ACC”** action that calls bootstrap; a returning visitor with a valid cookie loads straight into their workspace. Every `/api/*` financial route still requires a valid server session — missing, invalid, expired, revoked or spoofed identities are rejected with `401`, and spoofed `owner`/email headers are ignored.

**Optional recovery email:** a visitor may add a contact email later. It is stored as `optional_contact_email`, is never used as an owner key, and never merges workspaces. ACC shows: *“This workspace is currently linked to this browser. Add verified recovery later to access it from another device.”* Cross-device recovery via a verified magic link is intentionally not implemented in this build; typed email never grants access.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Copy `.env.example` into the environment mechanism supported by the runtime. Never commit real credentials.

`APP_BASE_URL` is the only required value (the exact HTTPS public origin, no path). No authentication provider needs to be configured — ACC opens anonymously.

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

1. Apply every checked-in D1 migration (including `0010_deep_random.sql`, which rebuilds `users` for guest access and drops `oauth_states`). Existing verified users are preserved and tagged `access_mode='google'`.
2. Set `APP_BASE_URL` and only the approved optional providers. No auth provider is required.
3. Run the full verification gate.
4. Publish and test: Open ACC (guest bootstrap), onboarding, draft/approve/post, reversal, export, deletion in a disposable workspace, portfolio creation, sign-out, and provider-failure states.
5. Verify CSP/security headers and mobile/desktop layouts on the public origin.
6. Keep the earlier version available for application rollback and use D1 recovery only for an actual data-recovery event. See "Rollback" below.

## Rollback

- **This branch → previous Google build:** revert the application commits and redeploy. Migration `0010` keeps every legacy column (`google_subject`, `email`) populated for verified rows, so the older code can still resolve them. It does, however, drop `oauth_states`; to restore Google sign-in you must re-create that table (re-apply the migration that defined it) so PKCE state can persist. Financial records are untouched either way.
- **Data recovery:** migration `0010` is a `users` table rebuild. Do not hand-drop the new columns. For a genuine data-loss event, use D1 Time Travel to a pre-migration point in a rehearsed recovery — a code rollback never reverses an applied additive migration.

## Privacy and operational limits

- Complete accounting records are not sent to market-source providers.
- Ask ACC receives controlled tool results; it cannot directly post entries or execute trades.
- Public-source research never accesses private messages, private accounts, deleted content, or prohibited communities.
- Forecasting remains disabled until sufficient real history, independent sources, stable collection, acceptable missing data, and backtesting exist.
- Accounting, tax, legal, privacy, provider licensing, retention, and incident-response policies still require qualified human review before a regulated production launch.
