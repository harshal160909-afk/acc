import { cookies } from "next/headers";
import { getDatabase, type Database } from "./context";

const SESSION_COOKIE = "acc_session";
const OAUTH_STATE_COOKIE = "acc_oauth_state";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type AuthenticatedUser = {
  userId: string;
  email: string;
  displayName: string;
};

type RuntimeEnv = Record<string, string | undefined>;

type GoogleClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  nonce: string;
  exp: number;
  iat: number;
};

export async function getRuntimeEnv(): Promise<RuntimeEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as RuntimeEnv;
}

export function googleAuthConfiguration(env: RuntimeEnv) {
  const baseUrl = normalizeBaseUrl(env.APP_BASE_URL);
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!baseUrl || !clientId || !clientSecret) return null;
  return { baseUrl, clientId, clientSecret, redirectUri: `${baseUrl}/auth/google/callback` };
}

export async function getRequestIdentity(request: Request): Promise<AuthenticatedUser | null> {
  return identityForToken(cookieValue(request.headers.get("cookie"), SESSION_COOKIE));
}

export async function getServerIdentity(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  return identityForToken(store.get(SESSION_COOKIE)?.value ?? null);
}

async function identityForToken(rawToken: string | null): Promise<AuthenticatedUser | null> {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 256) return null;
  try {
    const database = await getDatabase();
    const now = Date.now();
    const result = await database.prepare(`
      SELECT u.id AS user_id, u.email, u.display_name
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.deleted_at IS NULL
      LIMIT 1
    `).bind(await sha256(rawToken), now).all<{ user_id: string; email: string; display_name: string }>();
    const row = result.results[0];
    if (!row) return null;
    return { userId: row.user_id, email: row.email, displayName: row.display_name };
  } catch {
    return null;
  }
}

export function unauthenticatedResponse(): Response {
  return Response.json(
    { error: "Your secure session has ended. Sign in with Google again." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export async function requireRequestIdentity(request: Request): Promise<AuthenticatedUser | Response> {
  return (await getRequestIdentity(request)) ?? unauthenticatedResponse();
}

export function sessionCookie(value: string, maxAgeSeconds = SESSION_TTL_SECONDS) {
  return serializeCookie(SESSION_COOKIE, value, {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 0 });
}

export function oauthStateCookie(value: string) {
  return serializeCookie(OAUTH_STATE_COOKIE, value, { httpOnly: true, secure: true, sameSite: "Lax", path: "/auth/google", maxAge: 600 });
}

export function clearOauthStateCookie() {
  return serializeCookie(OAUTH_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "Lax", path: "/auth/google", maxAge: 0 });
}

export function readOauthStateCookie(request: Request) {
  return cookieValue(request.headers.get("cookie"), OAUTH_STATE_COOKIE);
}

export async function createOauthState(database: Database, request: Request, returnTo: string) {
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(64);
  const nonce = randomBase64Url(32);
  const now = Date.now();
  await database.prepare(`
    INSERT INTO oauth_states (id_hash, browser_hash, code_verifier, nonce, return_to, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    await sha256(state), await browserHash(request), codeVerifier, nonce,
    safeReturnPath(returnTo), now, now + 10 * 60 * 1000,
  ).run();
  return { state, codeVerifier, codeChallenge: base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))), nonce };
}

export async function consumeOauthState(database: Database, request: Request, state: string) {
  const stateCookie = readOauthStateCookie(request);
  if (!stateCookie || !(await equalHash(stateCookie, state))) return null;
  const now = Date.now();
  const idHash = await sha256(state);
  const result = await database.prepare(`
    SELECT id_hash, browser_hash, code_verifier, nonce, return_to, expires_at
    FROM oauth_states WHERE id_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1
  `).bind(idHash, now).all<{
    id_hash: string; browser_hash: string; code_verifier: string; nonce: string; return_to: string; expires_at: number;
  }>();
  const row = result.results[0];
  if (!row || !(await equalHash(row.browser_hash, await browserHash(request)))) return null;
  await database.prepare("UPDATE oauth_states SET used_at = ? WHERE id_hash = ? AND used_at IS NULL").bind(now, idHash).run();
  return row;
}

export async function exchangeGoogleCode(
  config: NonNullable<ReturnType<typeof googleAuthConfiguration>>,
  code: string,
  codeVerifier: string,
) {
  const body = new URLSearchParams({
    code, client_id: config.clientId, client_secret: config.clientSecret,
    redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });
  const payload = await response.json() as { id_token?: string; error?: string };
  if (!response.ok || !payload.id_token) throw new Error(payload.error || "Google token exchange failed");
  return payload.id_token;
}

export async function verifyGoogleIdToken(idToken: string, clientId: string, nonce: string): Promise<GoogleClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Google ID token is malformed");
  const header = decodeJwtPart(parts[0]) as { alg?: string; kid?: string };
  const claims = decodeJwtPart(parts[1]) as GoogleClaims;
  if (header.alg !== "RS256" || !header.kid) throw new Error("Google ID token algorithm is not accepted");
  const jwksResponse = await fetch("https://www.googleapis.com/oauth2/v3/certs", { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new Error("Google signing keys are unavailable");
  const jwks = await jwksResponse.json() as { keys?: Array<JsonWebKey & { kid?: string; kty?: string }> };
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Google signing key was not found");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, fromBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!verified || !GOOGLE_ISSUERS.has(claims.iss) || !audience.includes(clientId)) throw new Error("Google ID token validation failed");
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw new Error("Google account email is not verified");
  if (claims.nonce !== nonce || claims.exp <= now || claims.iat > now + 60) throw new Error("Google ID token is expired or replayed");
  return claims;
}

export async function upsertGoogleUser(database: Database, claims: GoogleClaims): Promise<AuthenticatedUser> {
  const email = claims.email.trim().toLowerCase();
  const existing = await database.prepare(`
    SELECT id, google_subject, email, display_name FROM users
    WHERE google_subject = ? OR email = ? ORDER BY CASE WHEN google_subject = ? THEN 0 ELSE 1 END LIMIT 1
  `).bind(claims.sub, email, claims.sub).all<{ id: string; google_subject: string; email: string; display_name: string }>();
  const row = existing.results[0];
  if (row && row.google_subject !== claims.sub) throw new Error("This email is already linked to another Google identity");
  const userId = row?.id ?? crypto.randomUUID();
  const displayName = cleanDisplayName(claims.name, email);
  const now = Date.now();
  if (row) {
    await database.prepare("UPDATE users SET email = ?, display_name = ?, updated_at = ?, deleted_at = NULL WHERE id = ?")
      .bind(email, displayName, now, userId).run();
  } else {
    await database.prepare(`INSERT INTO users (id, google_subject, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(userId, claims.sub, email, displayName, now, now).run();
    await migrateLegacyEmailOwner(database, email, userId);
  }
  return { userId, email, displayName };
}

export async function createSession(database: Database, userId: string) {
  const token = randomBase64Url(48);
  const now = Date.now();
  const ttl = SESSION_TTL_SECONDS;
  await database.prepare(`INSERT INTO auth_sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(await sha256(token), userId, now, now + ttl * 1000, now).run();
  return token;
}

export async function revokeSession(database: Database, request: Request) {
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) await database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL").bind(Date.now(), await sha256(token)).run();
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://acc.invalid");
    if (parsed.origin !== "https://acc.invalid" || parsed.pathname.startsWith("/auth/")) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return "/"; }
}

async function migrateLegacyEmailOwner(database: Database, email: string, userId: string) {
  const tables = [
    "accounting_entries", "business_profiles", "workspaces", "workspace_memberships", "ai_threads", "ai_messages",
    "ai_tool_calls", "ai_feedback", "ai_drafts", "audit_events", "portfolios", "watchlist_items",
    "investment_transactions", "data_sources", "support_requests", "market_profiles", "market_sources",
    "market_collection_runs", "market_signals", "market_problem_clusters", "market_opportunities",
    "market_opportunity_events", "market_experiments", "market_competitor_insights", "market_alerts", "manual_price_snapshots",
  ];
  const statements = tables.map((table) => database.prepare(`UPDATE ${table} SET owner_key = ? WHERE owner_key = ?`).bind(userId, email));
  if (database.batch) await database.batch(statements);
  else for (const statement of statements) await statement.run();
}

function normalizeBaseUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") return null;
    return url.origin;
  } catch { return null; }
}

function cleanDisplayName(value: string | undefined, email: string) {
  const cleaned = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
  return cleaned || email.split("@")[0];
}

function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0 || pair.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(pair.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function serializeCookie(name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: "Lax"; path: string; maxAge: number }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `Max-Age=${options.maxAge}`, `SameSite=${options.sameSite}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function randomBase64Url(bytes: number) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function base64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJwtPart(value: string) {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(value))) as unknown;
}

export async function sha256(value: string) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function equalHash(left: string, right: string) {
  return (await sha256(left)) === (await sha256(right));
}

async function browserHash(request: Request) {
  return sha256(`${request.headers.get("user-agent") ?? "unknown"}|${request.headers.get("accept-language") ?? ""}`);
}
