import { and, eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { channel, conversation, event, message } from "@/db/schema";
import type { NormalisedAttachment } from "@/lib/channels/message";
import { getAdapter } from "@/lib/channels/registry";

import { NotFoundError, ValidationError } from "./errors";

export type ReplyActor = {
  id: string;
  accountId: string;
};

export type ReplyInput = {
  body: string;
  attachments?: NormalisedAttachment[];
};

export type ReplyResult = {
  messageId: string;
  conversationId: string;
  platformMessageId: string | null;
};

/**
 * An agent's reply on a conversation: build a normalised OutboundMessage,
 * hand it to the channel's adapter to deliver, then persist it as an
 * outbound `message` row plus a `replied` event and mark the conversation
 * read.
 *
 * Scoped hard to `actor.accountId`: the conversation lookup filters on it, so
 * an agent can never reply into — or even confirm the existence of — another
 * account's conversation (they get NotFoundError).
 *
 * Delivery happens before the DB write. For the website channel that send is
 * a no-op; for real channels a failed persist after a successful send would
 * leave an unlogged outbound message. An outbox/pending-status design is in
 * docs/backlog.md.
 */
export async function sendReply(
  db: AppDb,
  actor: ReplyActor,
  conversationId: string,
  input: ReplyInput,
): Promise<ReplyResult> {
  const body = input.body ?? "";
  const attachments = input.attachments ?? [];
  if (body.trim() === "" && attachments.length === 0) {
    throw new ValidationError("A reply needs text or an attachment");
  }

  const [thread] = await db
    .select({
      id: conversation.id,
      channelId: conversation.channelId,
      platformThreadId: conversation.platformThreadId,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.accountId, actor.accountId),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new NotFoundError("Conversation not found");
  }

  const [channelRow] = await db
    .select({ type: channel.type, config: channel.config })
    .from(channel)
    .where(
      and(
        eq(channel.id, thread.channelId),
        eq(channel.accountId, actor.accountId),
      ),
    )
    .limit(1);

  if (!channelRow) {
    throw new NotFoundError("Channel not found");
  }

  const adapter = getAdapter(channelRow.type);
  const sent = await adapter.sendOutbound(
    {
      body,
      attachments,
      thread: { platformId: thread.platformThreadId },
    },
    (channelRow.config ?? {}) as Record<string, unknown>,
  );

  return db.transaction(async (tx): Promise<ReplyResult> => {
    const [messageRow] = await tx
      .insert(message)
      .values({
        accountId: actor.accountId,
        conversationId: thread.id,
        channelId: thread.channelId,
        direction: "outbound",
        authorType: "agent",
        authorAgentId: actor.id,
        body,
        attachments,
        platformMessageId: sent.platformMessageId,
        sentAt: sent.deliveredAt,
      })
      .returning({ id: message.id });

    await tx.insert(event).values({
      accountId: actor.accountId,
      conversationId: thread.id,
      type: "replied",
      actorAgentId: actor.id,
      data: { messageId: messageRow.id },
    });

    await tx
      .update(conversation)
      .set({
        lastMessageAt: sent.deliveredAt,
        unreadCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(conversation.id, thread.id));

    return {
      messageId: messageRow.id,
      conversationId: thread.id,
      platformMessageId: sent.platformMessageId,
    };
  });
}
