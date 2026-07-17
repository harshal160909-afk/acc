# Dependency Security

`npm audit` at the time of this work reports **12 vulnerabilities
(1 low, 5 moderate, 6 high)**. Full output: `docs/baseline/audit.txt` and
`docs/final-verification/audit.txt` (unchanged by this work).

## Production-reachable vs dev-only

ACC ships to a Cloudflare Worker. The production runtime dependencies are only:

- `drizzle-orm`, `next`, `react`, `react-dom`

**None of the 12 advisories touch these.** Every finding is in the
build/dev/test tool-chain, which never runs in the deployed Worker:

| Package | Severity | Advisory | Reachability |
|---|---|---|---|
| `vite` | high | `server.fs.deny` bypass / launch-editor NTLM (Windows dev) | Dev server only |
| `esbuild` | moderate | dev-server request/response read | Dev/build only |
| `@cloudflare/vite-plugin` → `miniflare` | high | via `undici` | Local emulation only |
| `miniflare` → `undici` | high | TLS validation bypass in SOCKS5 ProxyAgent | Local emulation only |
| `undici` | high | TLS cert validation bypass | Build tooling only |
| `ws` | high | uninitialized memory disclosure / DoS | Dev tooling (miniflare) |
| `wrangler` → `esbuild` | high | see esbuild | Deploy CLI only |
| `drizzle-kit` → `@esbuild-kit/*` | moderate | esbuild transitive | Migration generation only |
| `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader` | moderate | esbuild | Migration generation only |
| `js-yaml` | moderate | quadratic-complexity DoS via merge keys | Build tooling only |
| `@babel/core` | low | arbitrary file read via sourceMappingURL | Build tooling only |

## Remediation decision

- **Safe non-breaking upgrades:** `npm audit fix` (without `--force`) resolves
  **nothing** here — every fix is gated behind a breaking/out-of-range bump.
- **Forced upgrades:** the only offered fixes are `npm audit fix --force`, which
  would install `vite@8.1.5` and `@cloudflare/vite-plugin@1.45.1` **outside the
  stated dependency ranges**. `vinext@0.0.50` pins its Vite/RSC integration to
  the current versions; forcing these risks breaking the production build. Per
  the brief, `npm audit fix --force` was **not** run blindly.
- **Verification gate:** typecheck, lint, build and the 35-test suite all pass on
  the current lockfile.

## Deferred advisories (with reason)

All 12 are **deferred** because they are dev/build-chain only and not reachable
from the deployed Worker, and the available fixes are breaking upgrades that
threaten the `vinext`/Cloudflare build. Recommended follow-up (separate, tested
change): bump `vite`, `@cloudflare/vite-plugin`, `wrangler` and `drizzle-kit`
together to versions validated against the pinned `vinext` release, re-running
the full gate after the group — exactly the "upgrade a group, re-verify" loop
the brief prescribes.

## Operational note

CI should run `npm audit --omit=dev` to confirm the **production** dependency
tree stays clean (it currently reports 0), and treat dev-chain advisories as a
separate, non-blocking track.
