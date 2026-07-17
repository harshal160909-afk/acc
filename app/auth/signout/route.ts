import { clearSessionCookie, revokeSession } from "@/app/lib/server/auth";
import { getDatabase } from "@/app/lib/server/context";

export async function GET(request: Request) {
  try { await revokeSession(await getDatabase(), request); } catch { /* The cookie is still cleared. */ }
  return new Response(null, {
    status: 302,
    headers: { Location: new URL("/", request.url).toString(), "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" },
  });
}
