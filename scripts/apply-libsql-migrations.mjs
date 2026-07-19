// Apply ACC's Drizzle migrations to a libSQL / Turso database.
//
// Usage:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/apply-libsql-migrations.mjs
//   # local file for testing:
//   TURSO_DATABASE_URL=file:./acc.db node scripts/apply-libsql-migrations.mjs
//
// It runs every drizzle/*.sql file in order, splitting on Drizzle's
// `--> statement-breakpoint` markers. Safe to re-run: the migrations use
// CREATE TABLE / rebuild patterns from a clean database; point it at a fresh
// database (or one already at an earlier ACC schema) exactly once per version.
import { createClient } from "@libsql/client";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
if (!url) {
  console.error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for a remote database).");
  process.exit(1);
}

const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;
const client = createClient({ url, authToken });
const migrationsDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "drizzle");

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
for (const file of files) {
  const sql = await readFile(join(migrationsDir, file), "utf8");
  for (let statement of sql.split("--> statement-breakpoint")) {
    statement = statement.replace(/^\s*--.*$/gm, "").trim();
    if (!statement) continue;
    await client.execute(statement);
    applied += 1;
  }
  console.log(`applied ${file}`);
}
console.log(`\nDone: ${files.length} migration files, ${applied} statements.`);
