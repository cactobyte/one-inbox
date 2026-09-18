import { db } from "@/db";
import { getCurrentAgent } from "@/lib/auth";
import { GeminiApiError, GeminiConfigError } from "@/lib/ai/gemini";
import { suggestReply } from "@/lib/ai/suggest-reply";
import { NotFoundError, ValidationError } from "@/lib/inbox/errors";
import { listMessages } from "@/lib/inbox/queries";
import { jsonError, jsonOk } from "@/lib/http";

type RouteContext = { params: Promise<{ conversationId: string }> };

/**
 * Draft a suggested reply (CLAUDE.md milestone M14) — never sent, only
 * returned for the agent to review, edit or discard through the existing
 * reply form. Reuses the same account-scoped `listMessages` query the
 * conversation view reads, so the AI provider only ever sees this one
 * conversation's own recent messages.
 */
export async function POST(_request: Request, context: RouteContext) {
  const agent = await getCurrentAgent();
  if (!agent) {
    return jsonError("Sign in required", 401, "unauthorised");
  }

  const { conversationId } = await context.params;

  try {
    const { items } = await listMessages(db, agent.accountId, conversationId);
    const suggestion = await suggestReply(items);
    return jsonOk({ suggestion });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return jsonError(error.message, 404, "conversation_not_found");
    }
    if (error instanceof ValidationError) {
      return jsonError(error.message, 400, "invalid_payload");
    }
    if (error instanceof GeminiConfigError) {
      return jsonError("AI suggestions are not configured", 503, "ai_not_configured");
    }
    if (error instanceof GeminiApiError) {
      return jsonError(error.message, 502, "ai_request_failed");
    }
    throw error;
  }
}
