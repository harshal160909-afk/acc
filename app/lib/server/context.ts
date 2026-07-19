export type D1Result<T = unknown> = { results: T[]; success: boolean };
export type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  run: () => Promise<D1Result>;
  all: <T = unknown>() => Promise<D1Result<T>>;
};
export type Database = {
  prepare: (query: string) => D1Statement;
  batch?: (statements: D1Statement[]) => Promise<D1Result[]>;
};

export async function getDatabase(): Promise<Database> {
  // Host-agnostic resolution. When a libSQL/Turso database is configured (e.g.
  // on Netlify or any Node host), use it. Otherwise fall back to the Cloudflare
  // D1 binding. The SQLite schema and migrations are identical for both.
  const tursoUrl = readProcessEnv("TURSO_DATABASE_URL") ?? readProcessEnv("LIBSQL_URL");
  if (tursoUrl) {
    const { createLibsqlDatabase } = await import("./database-libsql");
    return createLibsqlDatabase(tursoUrl, readProcessEnv("TURSO_AUTH_TOKEN") ?? readProcessEnv("LIBSQL_AUTH_TOKEN"));
  }
  try {
    const { env } = await import("cloudflare:workers");
    const database = env.DB as Database | undefined;
    if (database) return database;
  } catch {
    // Not running on Cloudflare Workers; fall through to the error below.
  }
  throw new Error("ACC database is unavailable");
}

// Reads an environment variable in a way that is safe on every runtime: Node
// and Netlify expose process.env; the Cloudflare worker has no `process`.
function readProcessEnv(name: string): string | undefined {
  try {
    const runtime = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const value = runtime?.env?.[name];
    return value && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export async function ensureStore(database: Database): Promise<void> {
  const required = await database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('users', 'auth_sessions', 'workspaces', 'accounting_entries')
  `).all<{ name: string }>();
  if (required.results.length !== 4) {
    throw new Error("ACC database migrations have not been applied");
  }
}

export type WorkspaceAccess = { id: string; name: string; kind: string; role: string };

export async function resolveWorkspace(
  database: Database,
  ownerKey: string,
): Promise<WorkspaceAccess> {
  await ensureStore(database);
  const existing = await database.prepare(`
    SELECT w.id, w.name, w.kind, m.role
    FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
    WHERE m.owner_key = ? AND w.archived_at IS NULL
    ORDER BY CASE w.kind WHEN 'business' THEN 0 ELSE 1 END, w.created_at ASC
    LIMIT 1
  `).bind(ownerKey).all<WorkspaceAccess>();
  if (existing.results[0]) return existing.results[0];

  const profile = await database.prepare(`
    SELECT workspace_name FROM business_profiles WHERE owner_key = ? LIMIT 1
  `).bind(ownerKey).all<{ workspace_name: string }>();
  const id = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const now = Date.now();
  const name = profile.results[0]?.workspace_name?.trim() || "My business";
  const createWorkspace = database.prepare(`
    INSERT INTO workspaces (id, owner_key, name, kind, created_at, updated_at)
    VALUES (?, ?, ?, 'business', ?, ?)
  `).bind(id, ownerKey, name, now, now);
  const createMembership = database.prepare(`
    INSERT INTO workspace_memberships (id, workspace_id, owner_key, role, created_at)
    VALUES (?, ?, ?, 'owner', ?)
  `).bind(membershipId, id, ownerKey, now);
  if (database.batch) {
    await database.batch([createWorkspace, createMembership]);
  } else {
    await createWorkspace.run();
    await createMembership.run();
  }
  return { id, name, kind: "business", role: "owner" };
}

export async function recordAuditEvent(
  database: Database,
  input: {
    workspaceId: string;
    ownerKey: string;
    eventType: string;
    entityType: string;
    entityReference?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  await database.prepare(`
    INSERT INTO audit_events (
      id, workspace_id, owner_key, event_type, entity_type,
      entity_reference, summary, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), input.workspaceId, input.ownerKey, input.eventType,
    input.entityType, input.entityReference ?? null, input.summary,
    input.metadata ? JSON.stringify(input.metadata) : null, Date.now(),
  ).run();
}

export function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
