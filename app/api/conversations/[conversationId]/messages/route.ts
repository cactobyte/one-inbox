import { getCurrentAgent } from "@/lib/auth";
import { db } from "@/db";
import { NotFoundError, ValidationError } from "@/lib/inbox/errors";
import { listMessages } from "@/lib/inbox/queries";
import { sendReply } from "@/lib/inbox/reply";
import { jsonError, jsonOk } from "@/lib/http";

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * List messages in a conversation, oldest first. Scoped to the agent's
 * account at the query layer (lib/inbox/queries.ts): a conversation id from
 * another account 404s, it does not come back as an empty list. Paginated
 * per CLAUDE.md rule 4.
 */
export async function GET(request: Request, context: RouteContext) {
  const agent = await getCurrentAgent();
  if (!agent) {
    return jsonError("Sign in required", 401, "unauthorised");
  }

  const { conversationId } = await context.params;
  const cursorToken = new URL(request.url).searchParams.get("cursor");

  try {
    const { items, nextCursor } = await listMessages(
      db,
      agent.accountId,
      conversationId,
      { cursorToken },
    );
    return jsonOk({ items, nextCursor });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return jsonError(error.message, 404, "conversation_not_found");
    }
    throw error;
  }
}

/**
 * Post an agent reply into a conversation. The reply is delivered through the
 * conversation's channel adapter and stored as an outbound message.
 *
 * Auth is the agent session cookie; the write is scoped to the agent's
 * account, so a conversation id from another account resolves to 404.
 */
export async function POST(request: Request, context: RouteContext) {
  const agent = await getCurrentAgent();
  if (!agent) {
    return jsonError("Sign in required", 401, "unauthorised");
  }

  const { conversationId } = await context.params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Body is not valid JSON", 400, "invalid_json");
  }

  const input = payload as { body?: unknown; attachments?: unknown };
  if (typeof input.body !== "string" && input.body !== undefined) {
    return jsonError('"body" must be a string', 400, "invalid_payload");
  }

  try {
    const result = await sendReply(
      db,
      { id: agent.id, accountId: agent.accountId },
      conversationId,
      {
        body: typeof input.body === "string" ? input.body : "",
        attachments: Array.isArray(input.attachments)
          ? (input.attachments as never[])
          : undefined,
      },
    );
    return jsonOk(result, 201);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return jsonError(error.message, 404, "conversation_not_found");
    }
    if (error instanceof ValidationError) {
      return jsonError(error.message, 400, "invalid_payload");
    }
    throw error;
  }
}
