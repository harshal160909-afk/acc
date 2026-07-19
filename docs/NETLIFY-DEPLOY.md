# Deploying ACC to Netlify

ACC was built for Cloudflare Workers + D1, but it also runs on **Netlify**
(Functions) backed by a **libSQL / Turso** database instead of D1. No
application rewrite is required — ACC's data layer already talks to one small
database interface, and the built server handler runs on standard web APIs
under Node.

## How it works on Netlify

- **Server:** the `vinext` build (`dist/server/index.js`) is a Worker-style
  `{ fetch(request, env, ctx) }` handler. `netlify/functions/server.mjs` invokes
  it for every request; `netlify.toml` routes `/*` to that function with
  `preferStatic`, so real files in `dist/client` are served by Netlify's CDN
  first and everything else (the SSR page and `/api/*`) hits the function.
- **Database:** `getDatabase()` uses libSQL when `TURSO_DATABASE_URL` is set
  (via `app/lib/server/database-libsql.ts`), otherwise the Cloudflare D1
  binding. The SQLite schema and the `drizzle/` migrations are identical on both.
- **Identity/sessions:** unchanged. API routes read the session from the request
  cookie, so guest bootstrap, isolation and all financial routes work as-is.

### Verified

Under plain Node (the same runtime class as Netlify Functions), through the
Netlify adapter and a libSQL database:

- `GET /` returns the ACC landing HTML with security headers.
- `POST /api/session/bootstrap` returns 200, sets the `acc_session` cookie and
  creates an isolated guest workspace.
- Session restore and authorized `GET /api/profile` return 200.

What still requires **your** Netlify account and a Turso database (and may need
minor iteration on the first real deploy): the live Netlify build/function
bundling and the hosted database. Steps below.

## 1. Create the database (Turso)

```bash
# Install the Turso CLI: https://docs.turso.tech/cli
turso auth login
turso db create acc
turso db show acc --url            # -> TURSO_DATABASE_URL (libsql://...)
turso db tokens create acc         # -> TURSO_AUTH_TOKEN
```

Apply ACC's migrations to it:

```bash
TURSO_DATABASE_URL="libsql://...ceo.turso.io" \
TURSO_AUTH_TOKEN="..." \
npm run db:migrate:libsql
```

(You can rehearse locally first with `TURSO_DATABASE_URL=file:./acc.db npm run db:migrate:libsql`.)

## 2. Configure the Netlify site

Connect the repo in the Netlify UI (or `netlify init` with the Netlify CLI).
`netlify.toml` already sets the build command (`npm run build`), the publish
directory (`dist/client`), Node 22, and the esbuild function bundler.

Set environment variables on the site (Site settings → Environment):

```
TURSO_DATABASE_URL = libsql://...turso.io
TURSO_AUTH_TOKEN   = <token>
APP_BASE_URL       = https://<your-site>.netlify.app   # your exact origin
# Optional providers (ACC opens anonymously without any of these):
# OPENAI_API_KEY, OPENAI_MODEL, NVIDIA_*, REDDIT_*, YOUTUBE_* …
```

There is no auth provider to configure — access is anonymous guest sessions.

## 3. Deploy

```bash
# Netlify CLI:
netlify deploy --build --prod
# or push to the connected branch and let Netlify build.
```

Netlify runs `npm run build`, bundles `netlify/functions/server.mjs` (including
`dist/server/**` per `netlify.toml`), and serves the site.

## 4. Smoke test the live URL

Open ACC → onboarding (3 fields) → post a transaction → reverse → export →
delete in a disposable workspace → sign out. Confirm security headers.

## Known limitations / first-deploy notes

- **Function bundling:** if esbuild fails to bundle a `vinext` server
  dependency, add it to `[functions] external_node_modules` in `netlify.toml`
  and redeploy. `@libsql/client` is a normal dependency and bundles fine.
- **Image optimization:** the Cloudflare `IMAGES` binding is not available on
  Netlify. ACC ships static SVG/PNG assets, so this is unused on served paths;
  if you later add on-the-fly image optimization, use Netlify Image CDN.
- **Cloudflare is unaffected:** none of this changes the Cloudflare path — with
  no `TURSO_DATABASE_URL`, `getDatabase()` uses D1 exactly as before, and the
  full Cloudflare build/test gate stays green.

## Rollback

Netlify keeps every deploy; use "Publish deploy" on a previous build to roll
back instantly. The database is separate — a code rollback never alters applied
Turso migrations.
