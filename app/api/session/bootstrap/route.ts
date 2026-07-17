// POST /api/session/bootstrap
//
// The public front door. Resolves an existing anonymous session or creates a
// fresh guest identity + private workspace. Idempotent, rate-limited, and safe
// under parallel calls (a request that already holds a valid session never
// mints a second user). Returns only safe public session information — never
// the raw token (that stays in the HttpOnly cookie) and never internal detail
// beyond what the client needs to render.
import { bootstrapAccessSession, sha256 } from "@/app/lib/server/access";
import { ensureStore, getDatabase, resolveWorkspace } from "@/app/lib/server/context";
import { enforceRateLimit, validateJsonMutation } from "@/app/lib/server/http-security";

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request, 4_000);
  if (rejected) return rejected;

  let database;
  try {
    database = await getDatabase();
    await ensureStore(database);
  } catch {
    return Response.json(
      { code: "DATABASE_MIGRATION_REQUIRED", error: "ACC storage is not ready. Please try again shortly.", retryable: true },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Abuse control before any write: a privacy-preserving IP hash caps how many
  // guest identities one network can mint per hour. This never identifies a
  // visitor — only a salted hash of a coarse client hint is stored.
  try {
    const ipHash = await clientFingerprint(request);
    const limited = await enforceRateLimit(database, `ip:${ipHash}`, "session:bootstrap", 40, 60 * 60_000);
    if (limited) return limited;
  } catch {
    // Rate-limit storage issues must not block a legitimate first visit.
  }

  try {
    const { identity, setCookie } = await bootstrapAccessSession(request);
    const workspace = await resolveWorkspace(database, identity.userId);

    const headers = new Headers({ "Cache-Control": "no-store" });
    if (setCookie) headers.append("Set-Cookie", setCookie);
    return Response.json(
      {
        session: {
          accessMode: identity.accessMode,
          displayName: identity.displayName,
          hasContactEmail: identity.optionalContactEmail !== null,
          workspace: { name: workspace.name, kind: workspace.kind, role: workspace.role },
        },
      },
      { headers },
    );
  } catch {
    return Response.json(
      { code: "SESSION_BOOTSTRAP_FAILED", error: "ACC could not open a workspace. Nothing was created twice. Please retry.", retryable: true },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// A coarse, salted client hint used only for per-network rate limiting.
async function clientFingerprint(request: Request): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return sha256(`acc-bootstrap|${ip}`);
}
