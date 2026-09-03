import { and, eq, sql } from "drizzle-orm";

import type { AppDb } from "@/db";
import { contact, conversation, event, message } from "@/db/schema";
import type { InboundMessage } from "@/lib/channels/message";

import { isUniqueViolation } from "./errors";

/** The channel the message arrived on. Just the two fields ingest needs. */
export type IngestChannel = {
  id: string;
  accountId: string;
};

export type IngestResult = {
  /** `duplicate` means this platformMessageId had already been ingested. */
  status: "created" | "duplicate";
  accountId: string;
  channelId: string;
  conversationId: string;
  contactId: string;
  messageId: string;
};

async function findExistingMessage(
  db: AppDb,
  channelId: string,
  platformMessageId: string,
) {
  const [row] = await db
    .select({
      messageId: message.id,
      conversationId: conversation.id,
      contactId: conversation.contactId,
      accountId: conversation.accountId,
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(message.channelId, channelId),
        eq(message.platformMessageId, platformMessageId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Ingest one normalised inbound message.
 *
 *  - Idempotent on `(channelId, platformMessageId)`: the same platform message
 *    twice writes exactly one `message` row and one `message_received` event.
 *  - Find-or-create the `contact` (by `platformContactId`) and the
 *    `conversation` (by `platformThreadId`), all inside one transaction.
 *  - A brand-new conversation also gets a `created` event; an inbound message
 *    on a resolved conversation reopens it and gets a `reopened` event.
 *
 * Every write is scoped to `channel.accountId`. The caller has already
 * resolved and authorised the channel.
 */
export async function ingestInbound(
  db: AppDb,
  channel: IngestChannel,
  inbound: InboundMessage,
): Promise<IngestResult> {
  const { id: channelId, accountId } = channel;

  try {
    return await db.transaction(async (tx): Promise<IngestResult> => {
      const alreadySeen = await findExistingMessage(
        tx as AppDb,
        channelId,
        inbound.platformMessageId,
      );
      if (alreadySeen) {
        return {
          status: "duplicate",
          accountId,
          channelId,
          conversationId: alreadySeen.conversationId,
          contactId: alreadySeen.contactId,
          messageId: alreadySeen.messageId,
        };
      }

      // Contact: upsert by (account_id, platform_contact_id). onConflictDoUpdate
      // guarantees a returned row whether it was inserted or already existed.
      const [contactRow] = await tx
        .insert(contact)
        .values({
          accountId,
          platformContactId: inbound.contact.platformId,
          displayName: inbound.contact.displayName,
          email: inbound.contact.email ?? null,
          phone: inbound.contact.phone ?? null,
        })
        .onConflictDoUpdate({
          target: [contact.accountId, contact.platformContactId],
          set: { displayName: inbound.contact.displayName, updatedAt: new Date() },
        })
        .returning({ id: contact.id });

      // Conversation: find by (channel_id, platform_thread_id), else create.
      const [existingConversation] = await tx
        .select({ id: conversation.id, status: conversation.status })
        .from(conversation)
        .where(
          and(
            eq(conversation.channelId, channelId),
            eq(conversation.platformThreadId, inbound.thread.platformId),
          ),
        )
        .limit(1);

      let conversationId: string;

      if (existingConversation) {
        conversationId = existingConversation.id;
        const reopened = existingConversation.status === "resolved";
        await tx
          .update(conversation)
          .set({
            lastMessageAt: inbound.sentAt,
            unreadCount: sql`${conversation.unreadCount} + 1`,
            status: reopened ? "open" : existingConversation.status,
            updatedAt: new Date(),
          })
          .where(eq(conversation.id, conversationId));
        if (reopened) {
          await tx.insert(event).values({
            accountId,
            conversationId,
            type: "reopened",
            data: { reason: "inbound_message" },
          });
        }
      } else {
        const [conversationRow] = await tx
          .insert(conversation)
          .values({
            accountId,
            channelId,
            contactId: contactRow.id,
            platformThreadId: inbound.thread.platformId,
            status: "open",
            unreadCount: 1,
            lastMessageAt: inbound.sentAt,
          })
          .returning({ id: conversation.id });
        conversationId = conversationRow.id;
        await tx.insert(event).values({
          accountId,
          conversationId,
          type: "created",
          data: { via: "inbound_message" },
        });
      }

      const [messageRow] = await tx
        .insert(message)
        .values({
          accountId,
          conversationId,
          channelId,
          direction: "inbound",
          authorType: "contact",
          body: inbound.body,
          attachments: inbound.attachments,
          platformMessageId: inbound.platformMessageId,
          sentAt: inbound.sentAt,
        })
        .returning({ id: message.id });

      await tx.insert(event).values({
        accountId,
        conversationId,
        type: "message_received",
        data: { messageId: messageRow.id },
      });

      return {
        status: "created",
        accountId,
        channelId,
        conversationId,
        contactId: contactRow.id,
        messageId: messageRow.id,
      };
    });
  } catch (error) {
    // Lost a race with an identical webhook: the message unique constraint
    // fired. The winner's rows are committed now — read them back.
    if (isUniqueViolation(error)) {
      const existing = await findExistingMessage(
        db,
        channelId,
        inbound.platformMessageId,
      );
      if (existing) {
        return {
          status: "duplicate",
          accountId,
          channelId,
          conversationId: existing.conversationId,
          contactId: existing.contactId,
          messageId: existing.messageId,
        };
      }
    }
    throw error;
  }
}
