import { getRequestIdentity, unauthenticatedResponse } from "@/app/lib/server/auth";
import { ensureStore, getDatabase, recordAuditEvent, resolveWorkspace } from "@/app/lib/server/context";
import { enforceRateLimit, validateJsonMutation } from "@/app/lib/server/http-security";

function validText(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}

export async function POST(request: Request) {
  const rejected = validateJsonMutation(request);
  if (rejected) return rejected;
  const identity = await getRequestIdentity(request);
  if (!identity) return unauthenticatedResponse();
  const email = identity.userId;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  const topic = validText(body.topic, 80);
  const message = validText(body.message, 2_000);
  if (!topic || !message) return Response.json({ error: "Add a topic and a message of 2,000 characters or fewer" }, { status: 400 });
  try {
    const database = await getDatabase(); await ensureStore(database);
    const limited = await enforceRateLimit(database, email, "support:write", 5, 60_000); if (limited) return limited;
    const workspace = await resolveWorkspace(database, email); const id = crypto.randomUUID();
    await database.prepare(`INSERT INTO support_requests (id, owner_key, workspace_id, topic, message, status, created_at) VALUES (?, ?, ?, ?, ?, 'received', ?)`)
      .bind(id, email, workspace.id, topic, message, Date.now()).run();
    await recordAuditEvent(database, { workspaceId: workspace.id, ownerKey: email, eventType: "support_request_created", entityType: "support_request", entityReference: id, summary: `Support request received: ${topic}` });
    return Response.json({ requestId: id, status: "received" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Your support request could not be saved" }, { status: 503 }); }
}
