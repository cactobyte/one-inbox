import { db } from "@/db";
import { getCurrentAgent } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { listConversations } from "@/lib/inbox/queries";

/**
 * List conversations for the signed-in agent's account. Same-origin only —
 * cookie-authenticated, no CORS (contrast with the widget-facing endpoints).
 * Paginated per CLAUDE.md rule 4: `?cursor=` in, `nextCursor` out.
 */
export async function GET(request: Request) {
  const agent = await getCurrentAgent();
  if (!agent) {
    return jsonError("Sign in required", 401, "unauthorised");
  }

  const cursorToken = new URL(request.url).searchParams.get("cursor");
  const { items, nextCursor } = await listConversations(db, agent.accountId, {
    cursorToken,
  });

  return jsonOk({ items, nextCursor });
}
