import { db } from "@/db";
import { sendBroadcast } from "@/lib/broadcast";
import { getCurrentAgent } from "@/lib/auth";
import { ValidationError } from "@/lib/inbox/errors";
import { jsonError, jsonOk } from "@/lib/http";

/**
 * Send a broadcast: one message body to many contacts, each on their own
 * channel (M13). Same shape as `POST /api/conversations/:id/messages` — agent
 * session cookie, JSON body, real status codes — this is a bulk version of
 * the same send, not a different mechanism.
 *
 * Always `200` once the input itself is valid: a per-recipient failure (a
 * disabled channel, a platform rejection) is reported in `results`, not as
 * an HTTP error — one bad recipient shouldn't make the whole call look like
 * it failed when the other nine sent fine.
 */
export async function POST(request: Request) {
  const agent = await getCurrentAgent();
  if (!agent) {
    return jsonError("Sign in required", 401, "unauthorised");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Body is not valid JSON", 400, "invalid_json");
  }

  const input = payload as { contactIds?: unknown; body?: unknown };
  if (!Array.isArray(input.contactIds) || !input.contactIds.every((c) => typeof c === "string")) {
    return jsonError('"contactIds" must be an array of strings', 400, "invalid_payload");
  }
  if (typeof input.body !== "string") {
    return jsonError('"body" must be a string', 400, "invalid_payload");
  }

  try {
    const results = await sendBroadcast(
      db,
      { id: agent.id, accountId: agent.accountId },
      { contactIds: input.contactIds, body: input.body },
    );
    return jsonOk({ results });
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonError(error.message, 400, "invalid_payload");
    }
    throw error;
  }
}
