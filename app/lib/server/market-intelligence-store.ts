import type { Database } from "./context";

export async function ensureMarketIntelligenceStore(database: Database) {
  const required = await database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'market_profiles', 'market_sources', 'market_collection_runs',
      'market_signals', 'market_problem_clusters', 'market_opportunities', 'market_experiments'
    )
  `).all<{ name: string }>();
  if (required.results.length !== 7) throw new Error("Market Intelligence migrations have not been applied");
}
