# Guest Data & Retention Policy

ACC opens for everyone with an **anonymous guest session**. This document states
what is stored, for how long, and how it is removed.

## What identifies a workspace

- An **immutable internal user id** (`users.id`, a UUID). This is the only
  tenancy key. It is never shown to the browser.
- A **session token**: a 48-byte random value. Only its **SHA-256 hash** is
  stored (`auth_sessions.id_hash`). The raw token exists only in the visitor's
  `acc_session` cookie (HttpOnly, Secure, SameSite=Lax, Path=/, 30-day expiry,
  rotated past half-life).
- **Email is never an identifier.** A visitor may add an optional
  `optional_contact_email` purely as contact information. It does not grant
  access, is not searched to merge workspaces, and is not verified.

## Retention

| Data | Retention |
|---|---|
| Guest identity + financial records | Kept while the workspace is in use; removed on account deletion. |
| Session tokens (hashes) | Expire 30 days after issue; rotated on active use; revoked on sign-out. |
| Abandoned guest sessions | Eligible for cleanup once **both** the session is expired **and** the workspace has **no posted entries** and no activity for 90 days (see below). |
| `rate_limit_events` | Windowed rows; safe to prune after their window closes. |
| `privacy_receipts` | A minimal, non-reversible record (hash of user id + action) proving deletion occurred. |

## Abandoned-session cleanup

A guest who opens ACC, does nothing, and never returns should not accumulate
forever. The intended cleanup (run from a scheduled task once a cron trigger is
configured — see README) removes, in an atomic batch:

1. `auth_sessions` rows past `expires_at`.
2. `users` (and their empty workspaces) that are guests, have `last_active_at`
   older than 90 days, and own **zero** posted `accounting_entries`,
   `portfolios`, or `investment_transactions`.

Workspaces that contain real financial records are **never** auto-deleted — only
the owner's explicit deletion removes them.

> Status: the cleanup **policy and query shape are defined here and the
> `last_active_at` marker is written on every bootstrap**, but the scheduled
> `scheduled()` worker that runs it is not enabled in this build (it requires a
> Cloudflare Cron trigger). This is stated honestly rather than implied to run.

## User rights

- **Export:** `GET /api/account` returns every owner-scoped row as JSON.
- **Deletion:** `DELETE /api/account` with the typed confirmation
  `DELETE ACC DATA` permanently removes all owner-scoped records in one atomic
  batch and clears the session.
