import { asc, desc, eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { channel, contact, conversation } from "@/db/schema";

import type { ConversationChannel } from "./inbox/queries";
import { ValidationError } from "./inbox/errors";
import { sendReply, type ReplyActor } from "./inbox/reply";

/**
 * Broadcast messaging (M13): send one message body to many contacts, each on
 * whatever channel they're on. Deliberately fire-and-forget — no `broadcast`
 * table (an eighth table needs asking first; see docs/decisions.md). Sending
 * a broadcast is just many ordinary replies: `sendBroadcast` loops
 * `sendReply` (`lib/inbox/reply.ts`) over each contact's most recently active
 * conversation, so it's the exact same adapter dispatch, persistence, and
 * `replied` event a single agent reply already produces — no second
 * send-and-persist implementation to keep in sync.
 *
 * A contact spanning two channels (rare — cross-channel merge is still
 * unsolved, docs/decisions.md day 3) gets exactly one send, into their most
 * recently active conversation, not one per channel — sending the same
 * broadcast twice to what might be the same human is worse than picking one.
 */

export type BroadcastTarget = {
  id: string;
  displayName: string;
  conversationId: string;
  channel: ConversationChannel;
};

/**
 * Every contact on this account, paired with the conversation a broadcast to
 * them would actually send into. A contact with no conversation can't exist
 * today (every contact is created by an inbound message — see M11 backlog),
 * so this never needs to fall back to "no target."
 */
export async function listBroadcastTargets(
  db: AppDb,
  accountId: string,
): Promise<BroadcastTarget[]> {
  const contacts = await db
    .select({ id: contact.id, displayName: contact.displayName })
    .from(contact)
    .where(eq(contact.accountId, accountId))
    .orderBy(asc(contact.displayName));

  // Every conversation on this account, most-recently-active first, so the
  // first one seen per `contactId` below is that contact's target. A plain
  // JS reduce over one account's conversations, not a correlated-subquery
  // column — Drizzle only table-qualifies identifiers a query's own
  // join shape requires, so a single-table `.from(contact)` with a raw `sql`
  // subquery referencing `contact.id` renders it unqualified and it
  // self-correlates against the subquery's own table instead.
  const conversations = await db
    .select({
      contactId: conversation.contactId,
      conversationId: conversation.id,
      channelId: channel.id,
      channelType: channel.type,
      channelName: channel.name,
    })
    .from(conversation)
    .innerJoin(channel, eq(channel.id, conversation.channelId))
    .where(eq(conversation.accountId, accountId))
    .orderBy(desc(conversation.lastMessageAt), desc(conversation.id));

  const mostRecentByContact = new Map<string, (typeof conversations)[number]>();
  for (const row of conversations) {
    if (!mostRecentByContact.has(row.contactId)) {
      mostRecentByContact.set(row.contactId, row);
    }
  }

  const targets: BroadcastTarget[] = [];
  for (const c of contacts) {
    const match = mostRecentByContact.get(c.id);
    if (!match) continue;
    targets.push({
      id: c.id,
      displayName: c.displayName,
      conversationId: match.conversationId,
      channel: { id: match.channelId, type: match.channelType, name: match.channelName },
    });
  }
  return targets;
}

export type BroadcastRecipientResult = {
  contactId: string;
  status: "sent" | "failed";
  error?: string;
};

export type BroadcastInput = {
  contactIds: string[];
  body: string;
};

/**
 * Send one message to many contacts. Sequential, not `Promise.all` — one
 * slow/failing platform call shouldn't race the rest, and each is its own
 * adapter call to a real external API. One contact failing (a disabled
 * channel, a platform rejection) does not stop the others; the caller sees
 * every outcome.
 */
export async function sendBroadcast(
  db: AppDb,
  actor: ReplyActor,
  input: BroadcastInput,
): Promise<BroadcastRecipientResult[]> {
  const body = input.body.trim();
  if (body === "") {
    throw new ValidationError("A broadcast needs a message");
  }

  const contactIds = [...new Set(input.contactIds)];
  if (contactIds.length === 0) {
    throw new ValidationError("Select at least one contact");
  }

  const targets = await listBroadcastTargets(db, actor.accountId);
  const targetById = new Map(targets.map((t) => [t.id, t]));

  const results: BroadcastRecipientResult[] = [];
  for (const contactId of contactIds) {
    const target = targetById.get(contactId);
    if (!target) {
      results.push({ contactId, status: "failed", error: "Contact not found" });
      continue;
    }
    try {
      await sendReply(db, actor, target.conversationId, { body });
      results.push({ contactId, status: "sent" });
    } catch (error) {
      results.push({
        contactId,
        status: "failed",
        error: error instanceof Error ? error.message : "Send failed",
      });
    }
  }
  return results;
}
