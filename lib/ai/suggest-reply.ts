import { generateText } from "./gemini";
import { ValidationError } from "../inbox/errors";

/**
 * AI-assisted replies (CLAUDE.md milestone M14): a drafted reply the agent
 * reviews, edits and sends themselves through the existing send path
 * (`lib/inbox/reply.ts`) — this module only ever drafts text, it never sends
 * anything or touches the database. Auto-reply rules (sending without a
 * human) are explicitly out of scope for M14 — see docs/decisions.md.
 */

export type ReplySuggestionMessage = { direction: "inbound" | "outbound"; body: string };

/** How much of the conversation to hand the model — enough context, bounded cost. */
const HISTORY_LIMIT = 10;

const SYSTEM_INSTRUCTION =
  "You are drafting a reply for a customer-service agent at a small " +
  "business, to send in an ongoing chat. Reply in the same language the " +
  "customer is using. Keep it short and direct — a sentence or two unless " +
  "the question genuinely needs more. Do not add a greeting or sign-off " +
  "unless the conversation doesn't have one yet. Reply with only the " +
  "message text, nothing else.";

export async function suggestReply(messages: ReplySuggestionMessage[]): Promise<string> {
  const recent = messages.slice(-HISTORY_LIMIT);
  if (!recent.some((m) => m.direction === "inbound")) {
    throw new ValidationError("Nothing from the customer to reply to yet");
  }

  const transcript = recent
    .map((m) => `${m.direction === "inbound" ? "Customer" : "Agent"}: ${m.body}`)
    .join("\n");

  const text = await generateText({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: `Conversation so far:\n${transcript}\n\nDraft the agent's next reply.`,
  });
  return text.trim();
}
