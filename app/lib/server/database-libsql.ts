// libSQL / Turso adapter for ACC.
//
// ACC's entire data layer talks to one small `Database` interface (see
// context.ts) that mirrors the Cloudflare D1 shape: `prepare(sql).bind(...).
// run()/.all()` plus an atomic `batch()`. This module implements that exact
// interface on top of libSQL (Turso), so the app runs unchanged on any host
// that can reach a libSQL database — including Netlify Functions — while
// keeping the SQLite schema and Drizzle migrations identical to D1.
import type { Database, D1Statement, D1Result } from "./context";

// A prepared statement carries its SQL and bound args so that batch() can
// re-read them. The private fields are internal to this adapter.
type LibsqlStatement = D1Statement & { readonly _sql: string; readonly _args: unknown[] };

type LibsqlClient = {
  execute: (query: { sql: string; args: unknown[] }) => Promise<{
    rows: Array<Record<string, unknown> | unknown[]>;
    columns: string[];
  }>;
  batch: (
    statements: Array<{ sql: string; args: unknown[] }>,
    mode?: "write" | "read" | "deferred",
  ) => Promise<unknown[]>;
};

function rowToObject<T>(row: Record<string, unknown> | unknown[], columns: string[]): T {
  if (Array.isArray(row)) {
    const object: Record<string, unknown> = {};
    columns.forEach((name, index) => { object[name] = row[index]; });
    return object as T;
  }
  return row as T;
}

/**
 * Build a D1-compatible `Database` backed by a libSQL/Turso client.
 * The libSQL client is imported dynamically (and hidden from static bundlers)
 * so this file never pulls a Node-only dependency into the Cloudflare worker
 * build, which does not use it.
 */
export async function createLibsqlDatabase(url: string, authToken?: string): Promise<Database> {
  // Non-literal specifier: keeps @libsql/client out of the Cloudflare build and
  // typecheck entirely (it is provided only by the Netlify/Node deployment).
  const specifier = "@libsql/client";
  const mod = (await import(/* @vite-ignore */ specifier)) as {
    createClient: (config: { url: string; authToken?: string }) => LibsqlClient;
  };
  const client = mod.createClient({ url, authToken });

  function statement(sql: string, args: unknown[]): LibsqlStatement {
    return {
      _sql: sql,
      _args: args,
      bind: (...values: unknown[]) => statement(sql, values),
      run: async (): Promise<D1Result> => {
        await client.execute({ sql, args });
        return { results: [], success: true };
      },
      all: async <T = unknown>(): Promise<D1Result<T>> => {
        const result = await client.execute({ sql, args });
        const results = result.rows.map((row) => rowToObject<T>(row, result.columns));
        return { results, success: true };
      },
    };
  }

  return {
    prepare: (query: string) => statement(query, []),
    batch: async (statements: D1Statement[]): Promise<D1Result[]> => {
      const prepared = statements.map((entry) => {
        const libsql = entry as LibsqlStatement;
        return { sql: libsql._sql, args: libsql._args };
      });
      await client.batch(prepared, "write");
      return statements.map(() => ({ results: [], success: true }));
    },
  };
}
