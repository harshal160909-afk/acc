// Client helpers for the anonymous access session.

export type BootstrapSession = {
  accessMode: "guest" | "google";
  displayName: string;
  hasContactEmail: boolean;
  workspace: { name: string; kind: string; role: string };
};

/**
 * Open (restore or create) an anonymous ACC session. Idempotent and safe to
 * call on load: if the browser already holds a valid session the same identity
 * is returned. Throws on a non-OK response so callers can show a clear state.
 */
export async function openAccSession(signal?: AbortSignal): Promise<BootstrapSession> {
  const response = await fetch("/api/session/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as { session?: BootstrapSession; error?: string };
  if (!response.ok || !body.session) {
    throw new Error(body.error || "ACC could not open your workspace. Please retry.");
  }
  return body.session;
}

/** Revoke the current session server-side, clear the cookie, and reload. */
export async function signOutAcc(): Promise<void> {
  try {
    await fetch("/api/session/signout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
  } finally {
    window.location.assign("/");
  }
}
