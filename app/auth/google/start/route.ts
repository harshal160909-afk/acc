import {
  createOauthState, googleAuthConfiguration, getRuntimeEnv,
  oauthStateCookie, safeReturnPath,
} from "@/app/lib/server/auth";
import { ensureStore, getDatabase } from "@/app/lib/server/context";

export async function GET(request: Request) {
  const env = await getRuntimeEnv();
  const config = googleAuthConfiguration(env);
  if (!config) return Response.redirect(new URL("/?auth=configuration_required", request.url), 302);

  const database = await getDatabase();
  await ensureStore(database);
  const url = new URL(request.url);
  const oauth = await createOauthState(database, request, safeReturnPath(url.searchParams.get("return_to")));
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: oauth.state,
    nonce: oauth.nonce,
    code_challenge: oauth.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorization.toString(),
      "Set-Cookie": oauthStateCookie(oauth.state),
      "Cache-Control": "no-store",
    },
  });
}
