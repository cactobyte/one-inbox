import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import type { AppDb } from "@/db";
import { channel, contact, conversation, message } from "@/db/schema";
import type { ChannelType } from "@/db/schema";

import { decodeCursor, encodeCursor } from "./cursor";
import { NotFoundError } from "./errors";

/**
 * Every query here takes `accountId` as a required argument and filters on
 * it directly — that is the enforcement CLAUDE.md rule 3 asks for. There is
 * no code path that fetches unscoped rows and hides the rest in the UI: a
 * conversation id from another account is indistinguishable from one that
 * doesn't exist at all (NotFoundError, not an empty/filtered result).
 *
 * Conversations from every channel come back in one list — there is no
 * per-channel filter and no `channel.type` branch. Each row carries its
 * channel so the UI can *label* it (a "LINE" / "Website" tag); the UI never
 * acts on the type (CLAUDE.md rule 2).
 */

const PAGE_SIZE = 30;

export type ConversationChannel = {
  id: string;
  type: ChannelType;
  name: string;
};

export type ConversationListItem = {
  id: string;
  status: "open" | "pending" | "resolved";
  unreadCount: number;
  lastMessageAt: Date | null;
  channel: ConversationChannel;
  contact: { id: string; displayName: string };
  lastMessage: { body: string; direction: "inbound" | "outbound" } | null;
};

/** Conversations for an account, most recently active first. */
export async function listConversations(
  db: AppDb,
  accountId: string,
  options: { cursorToken?: string | null } = {},
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
  const cursor = decodeCursor(options.cursorToken ?? null);

  const where = cursor
    ? and(
        eq(conversation.accountId, accountId),
        or(
          lt(conversation.lastMessageAt, cursor.createdAt),
          and(
            eq(conversation.lastMessageAt, cursor.createdAt),
            lt(conversation.id, cursor.id),
          ),
        ),
      )
    : eq(conversation.accountId, accountId);

  const rows = await db
    .select({
      id: conversation.id,
      status: conversation.status,
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt,
      channelId: channel.id,
      channelType: channel.type,
      channelName: channel.name,
      contactId: contact.id,
      contactName: contact.displayName,
      lastMessageBody: sql<string | null>`(
        select ${message.body} from ${message}
        where ${message.conversationId} = ${conversation.id}
        order by ${message.createdAt} desc
        limit 1
      )`,
      lastMessageDirection: sql<"inbound" | "outbound" | null>`(
        select ${message.direction} from ${message}
        where ${message.conversationId} = ${conversation.id}
        order by ${message.createdAt} desc
        limit 1
      )`,
    })
    .from(conversation)
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .innerJoin(channel, eq(channel.id, conversation.channelId))
    .where(where)
    .orderBy(desc(conversation.lastMessageAt), desc(conversation.id))
    .limit(PAGE_SIZE);

  const last = rows.at(-1);
  const nextCursor =
    last && rows.length === PAGE_SIZE && last.lastMessageAt
      ? encodeCursor({ createdAt: last.lastMessageAt, id: last.id })
      : null;

  return {
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      unreadCount: r.unreadCount,
      lastMessageAt: r.lastMessageAt,
      channel: { id: r.channelId, type: r.channelType, name: r.channelName },
      contact: { id: r.contactId, displayName: r.contactName },
      lastMessage: r.lastMessageBody
        ? { body: r.lastMessageBody, direction: r.lastMessageDirection! }
        : null,
    })),
    nextCursor,
  };
}

export type OwnedConversation = {
  id: string;
  accountId: string;
  status: "open" | "pending" | "resolved";
  channel: ConversationChannel;
  contact: { id: string; displayName: string; email: string | null };
};

/** A conversation, only if it belongs to this account — else NotFoundError. */
export async function getOwnedConversation(
  db: AppDb,
  accountId: string,
  conversationId: string,
): Promise<OwnedConversation> {
  const [row] = await db
    .select({
      id: conversation.id,
      accountId: conversation.accountId,
      status: conversation.status,
      channelId: channel.id,
      channelType: channel.type,
      channelName: channel.name,
      contactId: contact.id,
      contactName: contact.displayName,
      contactEmail: contact.email,
    })
    .from(conversation)
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .innerJoin(channel, eq(channel.id, conversation.channelId))
    .where(
      and(eq(conversation.id, conversationId), eq(conversation.accountId, accountId)),
    )
    .limit(1);

  if (!row) throw new NotFoundError("Conversation not found");

  return {
    id: row.id,
    accountId: row.accountId,
    status: row.status,
    channel: { id: row.channelId, type: row.channelType, name: row.channelName },
    contact: { id: row.contactId, displayName: row.contactName, email: row.contactEmail },
  };
}

export type MessageListItem = {
  id: string;
  direction: "inbound" | "outbound";
  authorType: "contact" | "agent" | "system";
  body: string;
  attachments: unknown;
  sentAt: Date;
  createdAt: Date;
};

/**
 * Messages for a conversation, oldest first. 404s (via getOwnedConversation)
 * before ever touching `message` if the conversation isn't this account's —
 * a foreign or made-up id can't be used to enumerate whether it exists.
 */
export async function listMessages(
  db: AppDb,
  accountId: string,
  conversationId: string,
  options: { cursorToken?: string | null } = {},
): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
  await getOwnedConversation(db, accountId, conversationId);

  const cursor = decodeCursor(options.cursorToken ?? null);
  const where = cursor
    ? and(
        eq(message.conversationId, conversationId),
        or(
          lt(message.createdAt, cursor.createdAt),
          and(eq(message.createdAt, cursor.createdAt), lt(message.id, cursor.id)),
        ),
      )
    : eq(message.conversationId, conversationId);

  // Fetch the most recent page (newest first), then present oldest-first —
  // the natural order for a conversation view.
  const rows = await db
    .select({
      id: message.id,
      direction: message.direction,
      authorType: message.authorType,
      body: message.body,
      attachments: message.attachments,
      sentAt: message.sentAt,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(where)
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(PAGE_SIZE);

  const last = rows.at(-1);
  const nextCursor =
    last && rows.length === PAGE_SIZE
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null;

  return { items: rows.reverse(), nextCursor };
}
