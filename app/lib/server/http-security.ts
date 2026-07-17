import type { Database } from "./context";

export function validateJsonMutation(request: Request, maximumBytes = 256_000): Response | null {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return problem(415, "Requests must use application/json");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maximumBytes) return problem(413, "Request is too large");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return problem(403, "Cross-site request was blocked");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return problem(403, "Cross-origin request was blocked");
    } catch { return problem(403, "Request origin is invalid"); }
  }
  return null;
}

export async function enforceRateLimit(
  database: Database,
  ownerKey: string,
  routeKey: string,
  maximum: number,
  windowMs: number,
): Promise<Response | null> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const id = `${ownerKey}:${routeKey}:${windowStart}`;
  await database.prepare(`
    INSERT INTO rate_limit_events (id, owner_key, route_key, window_start, request_count, updated_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(owner_key, route_key, window_start) DO UPDATE SET
      request_count = rate_limit_events.request_count + 1,
      updated_at = excluded.updated_at
  `).bind(id, ownerKey, routeKey, windowStart, Date.now()).run();
  const count = await database.prepare("SELECT request_count FROM rate_limit_events WHERE id = ? LIMIT 1")
    .bind(id).all<{ request_count: number }>();
  if ((count.results[0]?.request_count ?? maximum + 1) <= maximum) return null;
  const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - Date.now()) / 1000));
  return Response.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
  );
}

function problem(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
