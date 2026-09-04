import { and, asc, eq, gt, or } from "drizzle-orm";

import type { AppDb } from "@/db";
import { conversation, message } from "@/db/schema";

import { decodeCursor, encodeCursor } from "./cursor";

export type StreamMessage = {
  id: string;
  /**
   * The client's own id for a message it sent, if it has one — for the
   * website channel this is the widget's `messageId`, echoed back as
   * `platformMessageId` (day 2). The widget renders that id optimistically
   * before this message exists in the database, so the stream must expose
   * it: without it, reconciling the echo against the optimistic bubble by
   * id is comparing the wrong two values and the message renders twice.
   */
  platformMessageId: string | null;
  direction: "inbound" | "outbound";
  body: string;
  attachments: unknown;
  sentAt: Date;
  createdAt: Date;
};

const PAGE_SIZE = 100;

/**
 * Every message on a conversation strictly after `cursorToken`, oldest
 * first, plus the cursor to pass next time. This is the one piece of logic
 * that has to be correct for "reconnect without duplicating or dropping":
 * called with `null` it returns everything; called again with the cursor it
 * returned, it returns exactly what's new since — never repeats a row
 * already returned, never skips one inserted since.
 */
export async function fetchMessagesSince(
  db: AppDb,
  conversationId: string,
  cursorToken: string | null,
): Promise<{ messages: StreamMessage[]; nextCursor: string | null }> {
  const cursor = decodeCursor(cursorToken);

  const where = cursor
    ? and(
        eq(message.conversationId, conversationId),
        or(
          gt(message.createdAt, cursor.createdAt),
          and(eq(message.createdAt, cursor.createdAt), gt(message.id, cursor.id)),
        ),
      )
    : eq(message.conversationId, conversationId);

  const rows = await db
    .select({
      id: message.id,
      platformMessageId: message.platformMessageId,
      direction: message.direction,
      body: message.body,
      attachments: message.attachments,
      sentAt: message.sentAt,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(where)
    .orderBy(asc(message.createdAt), asc(message.id))
    .limit(PAGE_SIZE);

  const last = rows.at(-1);
  const nextCursor = last
    ? encodeCursor({ createdAt: last.createdAt, id: last.id })
    : cursorToken;

  return { messages: rows, nextCursor };
}

/** The conversation a widget's (channel, visitorId) thread maps to, if any. */
export async function findConversationByThread(
  db: AppDb,
  channelId: string,
  platformThreadId: string,
): Promise<{ id: string; accountId: string } | null> {
  const [row] = await db
    .select({ id: conversation.id, accountId: conversation.accountId })
    .from(conversation)
    .where(
      and(
        eq(conversation.channelId, channelId),
        eq(conversation.platformThreadId, platformThreadId),
      ),
    )
    .limit(1);
  return row ?? null;
}
