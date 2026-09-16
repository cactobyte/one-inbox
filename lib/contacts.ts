import { and, desc, eq, sql } from "drizzle-orm";

import type { AppDb } from "@/db";
import { channel, contact, conversation, message } from "@/db/schema";
import type { ConversationStatus } from "@/db/schema";

import type { ConversationChannel } from "./inbox/queries";
import { NotFoundError } from "./inbox/errors";

/**
 * Contact/CRM basics (M11). A contact's identity already spans channels —
 * `contact` is account-scoped, not channel-scoped (see
 * `lib/inbox/ingest.ts`'s upsert on `(accountId, platformContactId)`), and
 * `conversation.contactId` can point at the same contact from any channel.
 * So "history across all channels" needs no new linking: list every
 * conversation whose `contactId` matches, across every `channel`.
 *
 * `notes` is one nullable column on `contact` (not an eighth table) — plain
 * free text, no history of edits kept, the same choice CLAUDE.md's schema
 * cap forces for anything that doesn't need its own rows.
 */

export type ContactProfile = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
};

/** A contact, only if it belongs to this account — else NotFoundError. */
export async function getOwnedContact(
  db: AppDb,
  accountId: string,
  contactId: string,
): Promise<ContactProfile> {
  const [row] = await db
    .select({
      id: contact.id,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      notes: contact.notes,
      createdAt: contact.createdAt,
    })
    .from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.accountId, accountId)))
    .limit(1);

  if (!row) throw new NotFoundError("Contact not found");
  return row;
}

export type ContactConversation = {
  id: string;
  status: ConversationStatus;
  channel: ConversationChannel;
  lastMessageAt: Date | null;
  lastMessage: { body: string; direction: "inbound" | "outbound" } | null;
};

/**
 * Every conversation for this contact, most recently active first, each
 * carrying its channel — the cross-channel "history" the profile shows.
 * 404s (via `getOwnedContact`) before touching `conversation` if the contact
 * isn't this account's, same reasoning as `listMessages`.
 */
export async function listContactConversations(
  db: AppDb,
  accountId: string,
  contactId: string,
): Promise<ContactConversation[]> {
  await getOwnedContact(db, accountId, contactId);

  const rows = await db
    .select({
      id: conversation.id,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt,
      channelId: channel.id,
      channelType: channel.type,
      channelName: channel.name,
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
    .innerJoin(channel, eq(channel.id, conversation.channelId))
    .where(
      and(eq(conversation.contactId, contactId), eq(conversation.accountId, accountId)),
    )
    .orderBy(desc(conversation.lastMessageAt), desc(conversation.id));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    channel: { id: r.channelId, type: r.channelType, name: r.channelName },
    lastMessageAt: r.lastMessageAt,
    lastMessage: r.lastMessageBody
      ? { body: r.lastMessageBody, direction: r.lastMessageDirection! }
      : null,
  }));
}

/**
 * Overwrite this contact's notes. Scoped in the `WHERE`, same as
 * `cancelInvite` — a foreign contact id updates zero rows, not someone
 * else's row, and that's reported as NotFoundError rather than silently
 * doing nothing.
 */
export async function updateContactNotes(
  db: AppDb,
  accountId: string,
  contactId: string,
  notes: string | null,
): Promise<void> {
  const rows = await db
    .update(contact)
    .set({ notes, updatedAt: new Date() })
    .where(and(eq(contact.id, contactId), eq(contact.accountId, accountId)))
    .returning({ id: contact.id });

  if (rows.length === 0) throw new NotFoundError("Contact not found");
}
