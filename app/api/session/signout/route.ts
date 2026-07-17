// POST /api/session/signout
//
// Revokes the current anonymous session server-side and clears the cookie. The
// workspace and its records remain; a later bootstrap on this browser will need
// a fresh guest identity (or, if the same cookie is gone, a new one). This is a
// generalized session action — there is no Google redirect.
import { clearSessionCookie, revokeSession } from "@/app/lib/server/access";
import { getDatabase } from "@/app/lib/server/context";
import { validateJsonMutation } from "@/app/lib/server/http-security";

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request, 2_000);
  if (rejected) return rejected;
  try {
    await revokeSession(await getDatabase(), request);
  } catch {
    // The cookie is still cleared even if revocation storage is unavailable.
  }
  return Response.json(
    { signedOut: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": clearSessionCookie() } },
  );
}
