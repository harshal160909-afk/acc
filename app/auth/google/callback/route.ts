import {
  clearOauthStateCookie, consumeOauthState, createSession, exchangeGoogleCode,
  googleAuthConfiguration, getRuntimeEnv, sessionCookie, upsertGoogleUser, verifyGoogleIdToken,
} from "@/app/lib/server/auth";
import { ensureStore, getDatabase } from "@/app/lib/server/context";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const env = await getRuntimeEnv();
  const config = googleAuthConfiguration(env);
  if (!config) return redirectHome(request, "configuration_required");
  if (url.searchParams.get("error")) return redirectHome(request, "cancelled");

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state || code.length > 4096 || state.length > 256) return redirectHome(request, "invalid_state");

  try {
    const database = await getDatabase();
    await ensureStore(database);
    const oauth = await consumeOauthState(database, request, state);
    if (!oauth) return redirectHome(request, "invalid_state");
    const idToken = await exchangeGoogleCode(config, code, oauth.code_verifier);
    const claims = await verifyGoogleIdToken(idToken, config.clientId, oauth.nonce);
    const identity = await upsertGoogleUser(database, claims);
    const token = await createSession(database, identity.userId);
    const destination = new URL(oauth.return_to, config.baseUrl);
    const headers = new Headers({ Location: destination.toString(), "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookie(token));
    headers.append("Set-Cookie", clearOauthStateCookie());
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch {
    return redirectHome(request, "failed");
  }
}

function redirectHome(request: Request, reason: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL(`/?auth=${encodeURIComponent(reason)}`, request.url).toString(),
      "Set-Cookie": clearOauthStateCookie(),
      "Cache-Control": "no-store",
    },
  });
}
