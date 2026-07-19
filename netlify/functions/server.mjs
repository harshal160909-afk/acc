// Netlify Functions (v2) host for ACC.
//
// ACC's application is a `vinext` build that exports a Worker-style
// `{ fetch(request, env, ctx) }`. That built handler runs on standard web APIs
// (Request/Response/crypto.subtle), so it runs on Node — the ACC test suite
// already imports the same build and exercises it under Node. This function
// adapts Netlify's (Request, context) invocation to that handler.
//
// The database is NOT a Cloudflare binding here: getDatabase() reads
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the environment and uses the
// libSQL adapter, so no `env.DB` is required. `env` below only needs to expose
// process.env plus a couple of harmless shims for paths this function serves.
import worker from "../../dist/server/index.js";

export default async function handler(request, context) {
  const env = {
    ...process.env,
    // Static assets are served by Netlify's CDN (see netlify.toml, preferStatic),
    // so anything reaching the function does not need a real ASSETS binding.
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    // On-the-fly image optimization is a Cloudflare-only binding; ACC ships
    // static SVG/PNG assets, so this shim is unused on the served paths.
    IMAGES: undefined,
  };
  const ctx = {
    waitUntil: (promise) => { try { context.waitUntil?.(promise); } catch { /* best-effort */ } },
    passThroughOnException: () => {},
  };
  return worker.fetch(request, env, ctx);
}

// Route everything through the app, but let Netlify serve real static files
// from the publish directory first (assets, favicon, etc.).
export const config = { path: "/*", preferStatic: true };
