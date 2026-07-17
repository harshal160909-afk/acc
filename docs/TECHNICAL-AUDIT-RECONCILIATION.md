# ACC Technical Audit — Reconciliation

The attached audit examined **`ACC-complete-website-V12-Pastel-Editorial.zip`**.
The delivered artifact is **`acc-accounting-workspace` v10.0.0**, a later line that
already contains real server sessions, immutable user IDs, owner-scoped manual
prices, migration-only schema, context-specific Ask ACC tools, account
export/deletion and security headers. Every audit finding below was therefore
**re-verified against the actual v10 code**, not applied by line number.

Legend: **Already fixed** (fixed in v10 before this work) · **Fixed here**
(changed in this branch) · **Still present** · **Partially fixed** ·
**No longer applicable**.

Baseline verification of the delivered ZIP (see `docs/baseline/`): typecheck ✅,
lint ✅, build ✅, **tests 34/34 ✅** (the two money-parser failures the brief
anticipated were already resolved in v10 — the test transpiles `money.ts` via
the TypeScript compiler, so Node never imports a `.ts` file directly),
`npm audit` = 12 dev-chain vulnerabilities.

Final verification after this work (see `docs/final-verification/`): typecheck
✅, lint ✅, build ✅, **tests 35/35 ✅**, `npm audit` unchanged (dev-only,
documented in `docs/DEPENDENCY-SECURITY.md`).

---

### AUTH-001 — Identity is a trusted, unverified host header
- **Current status:** No longer applicable (as described) → **superseded/Fixed here**.
- **Current evidence:** v10 did **not** trust an `oai-authenticated-user-email`
  header; it already used a hashed server session (`app/lib/server/auth.ts`).
  The launch-gate test *"spoofed identity headers never authenticate financial
  mutations"* sends `oai-authenticated-user-email` / `x-authenticated-user-email`
  and asserts `401`. This branch replaces the Google front door with an
  anonymous guest session but keeps the identical verification contract.
- **Files affected:** `app/lib/server/access.ts` (new, replaces `auth.ts`),
  `app/api/session/bootstrap/route.ts` (new), every `/api/*` route (unchanged
  guard `getRequestIdentity → unauthenticatedResponse`).
- **Change made:** Identity resolves only from the `acc_session` cookie → SHA-256
  hash → `auth_sessions ⨝ users`. No header is ever trusted for identity.
- **Test proving the change:** `spoofed identity headers never authenticate…`,
  `profile and entry APIs reject every unauthenticated read and write…`,
  `Google OAuth is fully removed and the public front door is anonymous…`.
- **Remaining limitation:** None for the header-trust vector.

### AUTH-002 — Email is the permanent DB identity; no immutable user ID; sign-out does not invalidate
- **Current status:** **Already fixed** in v10, **strengthened here**.
- **Current evidence:** `users.id` (UUID) is the tenancy key everywhere
  (`owner_key = identity.userId`); email was already a mutable attribute.
  `revokeSession` sets `revoked_at`, and the session query excludes revoked rows.
- **Change made:** Email is now truly optional (`users.email` nullable,
  `optional_contact_email` added) and is documented as never an access key.
  Sign-out is a same-origin `POST /api/session/signout` that revokes the session
  server-side and clears the cookie. Session rotation added (refresh past half-life).
- **Test proving the change:** `P0 storage, approval, privacy and portfolio
  controls are wired to immutable owner identities`.
- **Remaining limitation:** Cross-device recovery (verified magic-link) is
  intentionally **not** implemented — see README. Typed email never grants access.

### INV-001 — Cross-tenant manual-price leakage
- **Current status:** **Already fixed** in v10.
- **Current evidence:** `manual_price_snapshots` carries `workspace_id` +
  `owner_key` (`db/schema.ts`); the investments route reads manual prices with
  `m.owner_key = ? AND m.workspace_id = ?` (asserted by launch-gate test
  *"P0 storage…"* → `FROM manual_price_snapshots … m.owner_key = ? … m.workspace_id = ?`).
- **Files affected:** none needed.
- **Remaining limitation:** Global `securities` / `price_snapshots` remain shared
  for *licensed* provider data (by design, tagged separately). No manual price
  crosses tenants.

### ACCT-001 — Legacy rupee `amount` column desyncs from journal totals
- **Current status:** **Partially fixed / contained** (unchanged here).
- **Current evidence:** `amount_paise` + `journal_lines_json` are canonical and
  are what `finance.ts` reads (proven by the CoGS/GST/trial-balance tests). The
  legacy `amount` rupee column still exists for back-compat migration.
- **Remaining limitation:** The legacy scalar can still under-report multi-line
  entries **if a future external consumer reads it**. Reports do not. Dropping
  the column is deferred (needs a data migration); documented, not silently
  trusted.

### AI-001 — CoGS extra journal lines not re-validated on approval
- **Current status:** **Already fixed** in v10.
- **Current evidence:** The approval path fully re-derives and compares the
  entire line array — launch-gate test asserts
  `expectedLines = deriveJournalLines … sameJournalLines(journalLines, expectedLines)`
  in `app/api/entries/route.ts`.
- **Remaining limitation:** None.

### AI-002 — Structured/document extraction built but unreachable; parser is regex
- **Current status:** **Still present (by design)**.
- **Current evidence:** The live path is the deterministic
  `continueTransactionConversation`; `OpenAIProvider.extractTransaction()` remains
  defined but unwired. This is the safe posture (deterministic engine is the
  source of truth).
- **Remaining limitation:** Optional structured extraction (Phase 6 of the brief)
  is **not** wired in this session. Documented as future work; the app is fully
  usable through guided deterministic entry with no provider.

### AI-003 — Ask ACC uses Books tools in every context
- **Current status:** **Already fixed** in v10.
- **Current evidence:** `app/api/ai/route.ts` has `selectedContextTool` /
  `executeContextTool` branching on `investments` and `market_news` contexts
  (`get_investment_record_summary`, `get_market_research_summary`).
- **Remaining limitation:** None for tool routing.

### DB-001 — Per-request DDL (CREATE/ALTER on the hot path)
- **Current status:** **Already fixed** in v10.
- **Current evidence:** `app/lib/server/context.ts` `ensureStore` only runs a
  `SELECT … FROM sqlite_master` existence check; schema is owned by the
  `drizzle/` migrations. Launch-gate test asserts context excludes
  `CREATE TABLE|ALTER TABLE`.
- **Change made here:** Added migration `0010` (guest-access schema) to the
  migration-only model; still zero request-time DDL.
- **Remaining limitation:** None.

### SEC-001 — No CSP / security headers / CORS / rate limits
- **Current status:** **Already fixed** in v10, **tightened here**.
- **Current evidence:** `worker/index.ts` sets CSP, HSTS, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, and an
  OPTIONS/origin allowlist. `http-security.ts` enforces JSON content-type,
  body-size, same-origin (`sec-fetch-site`/`origin`) and per-owner rate limits.
- **Change made:** Removed the Google `form-action https://accounts.google.com`
  CSP allowance (now `'self'`). Added per-network rate limiting on the public
  `bootstrap` endpoint (privacy-preserving IP hash).
- **Test proving the change:** `Google OAuth is fully removed and the public
  front door is anonymous, isolated, and rate limited` (asserts 415 + 403 pre-storage).
- **Remaining limitation:** Turnstile challenge for suspicious traffic is
  documented but not enabled (no CAPTCHA on normal visitors, by design).

### DB-002 — Multi-statement financial writes not transactional
- **Current status:** **Already fixed** in v10.
- **Current evidence:** AI approval uses `database.batch([...])` (launch-gate
  test asserts `database.batch(` around `aiDraftId`); account deletion uses an
  atomic batch.
- **Change made here:** Session rotation and guest+session creation also use
  `database.batch` where multiple writes are involved.
- **Remaining limitation:** D1 `batch()` is atomic but not a full interactive
  transaction; acceptable for these sequences.

### UX-001 — Onboarding is 9 mandatory steps
- **Current status:** **Fixed here**.
- **Current evidence:** `OnboardingFlow.tsx` now runs a progressive flow:
  `const fastStart = !initial` and `const totalSteps = fastStart ? 3 : 9`. A
  first-time visitor completes exactly three fields — name, business name,
  business type — and the primary action reads **“Open my workspace”**
  (`isLast = fastStart ? step === 2 : step === 8`). The fast-start submit posts a
  valid profile with zero opening balances and `legal_structure = not_specified`.
- **Files affected:** `app/components/OnboardingFlow.tsx`,
  `app/components/Workspace.tsx` (new `SetupChecklist`), `app/acc.css`.
- **Change made:** Legal structure, opening bank/cash/capital and connection
  mode are deferred to a **“Finish setup”** checklist shown in the Books overview
  of a fresh workspace (and still fully editable via Edit workspace, which keeps
  the 9-step detailed flow). Opening balances still lock after the first posted
  entry.
- **Test proving the change:** `onboarding is a three-field fast start and defers
  opening balances`; `a first-time visitor can create a workspace after three
  fields with default opening balances`.
- **Remaining limitation:** The plain-language “How was this paid?” settlement
  relabel (Cash / Bank-UPI-card / Customer still owes me / I still owe the
  supplier) in the transaction entry surface is not part of this change; the
  deterministic settlement engine already supports those cases.

### MI-001 — Monitoring frequency stored but no scheduler; forecasting unreachable
- **Current status:** **Still present**.
- **Current evidence:** `app/api/market-intelligence/route.ts` still passes
  `stableRuns: 0` and `backtestReady: false` to `forecastingGate`, and there is
  no `scheduled()` handler / cron. Research is on-demand only.
- **Remaining limitation:** Honest on-demand vs scheduled modes (Phase 7) are
  **not** implemented in this session. The pipeline already refuses to fabricate
  sources and gates forecasting shut, so nothing is over-claimed as running.

### PRIV-001 — No data export or account-deletion path
- **Current status:** **Already fixed** in v10.
- **Current evidence:** `app/api/account/route.ts` — `GET` exports all
  owner-scoped rows; `DELETE` requires typed `DELETE ACC DATA` and runs an atomic
  batch, then writes a `privacy_receipts` record and clears the cookie.
- **Change made here:** Deletion continues to work under the guest identity
  (keyed by `users.id`); cookie clear uses the generalized `clearSessionCookie`.
- **Remaining limitation:** None.

---

## Summary

| Audit ID | Status |
|---|---|
| AUTH-001 | Superseded — verified server session retained; header never trusted |
| AUTH-002 | Already fixed; email made explicitly optional + rotation/sign-out |
| INV-001  | Already fixed (owner/workspace-scoped manual prices) |
| ACCT-001 | Partially fixed / contained (canonical paise; legacy scalar retained) |
| AI-001   | Already fixed (full line re-derivation on approval) |
| AI-002   | Still present by design (deterministic parser live; extractor unwired) |
| AI-003   | Already fixed (context-routed Ask ACC tools) |
| DB-001   | Already fixed (migration-only schema) |
| SEC-001  | Already fixed; tightened (dropped Google CSP allowance, bootstrap limit) |
| DB-002   | Already fixed (D1 batch on multi-writes) |
| UX-001   | Fixed here (3-field fast start; opening balances deferred to a Books checklist) |
| MI-001   | Still present (no scheduler; forecasting gated shut — Phase 7 pending) |
| PRIV-001 | Already fixed (export + atomic deletion) |
