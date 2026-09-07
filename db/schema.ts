/**
 * One Inbox data model — seven tables, all scoped to `account`.
 *
 * Rules that shaped this file (see CLAUDE.md):
 *  - Every table except `account` carries `account_id`. No global rows.
 *  - `message` stores the platform's own id and is unique per channel, so
 *    redelivered webhooks never create duplicates.
 *  - `event` is append-only: conversation state changes are logged here for
 *    analytics and automation to read later.
 *
 * `channel.type`, `event.type` and a few status columns are plain text with a
 * TypeScript union rather than a Postgres enum: the product adds a channel
 * roughly every month and widening an enum is a migration each time.
 */
import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export type ChannelType =
  | "widget"
  | "line"
  | "messenger"
  | "instagram"
  | "whatsapp"
  | "shopee"
  | "lazada";

export type ConversationStatus = "open" | "pending" | "resolved";
export type MessageDirection = "inbound" | "outbound";
export type MessageAuthorType = "contact" | "agent" | "system";
export type AgentRole = "owner" | "admin" | "agent";

/** Conversation lifecycle events written to the append-only `event` table. */
export type EventType =
  | "created"
  | "message_received"
  | "message_sent"
  | "assigned"
  | "unassigned"
  | "replied"
  | "resolved"
  | "reopened"
  | "tagged"
  | "untagged";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/** The customer business. Everything else hangs off this. */
export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
});

/** A staff member who works the inbox. Roles exist from day one. */
export const agent = pgTable("agent", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<AgentRole>().notNull().default("agent"),
  // Bumped to invalidate every existing session for this agent (sign-out-
  // everywhere, and — from M5 — a password reset). The session cookie carries
  // the epoch it was minted at; `getCurrentAgent` rejects a mismatch. This is
  // the per-agent revocation the stateless-cookie design deferred on day 1
  // (docs/decisions.md), without adding a `session` table.
  sessionEpoch: integer("session_epoch").notNull().default(0),
  // Null until the agent confirms their email via the link sent at signup
  // (M4). Login is refused while null. Agents created before M4 (and by the
  // seed script) are backfilled to `now()` — see migration 0004.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  ...timestamps,
});

/** A connected inbox: this account's widget, LINE OA, WhatsApp number, ... */
export const channel = pgTable("channel", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  type: text("type").$type<ChannelType>().notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  ...timestamps,
});

/**
 * A person. May later be merged when the same human appears on two channels.
 *
 * `platformContactId` is the id the source platform uses for this person (a
 * LINE user id, a Messenger PSID, the widget's visitor token). An adapter
 * never writes here; the core uses it to find-or-create this row idempotently.
 * Unique per account, nullable for contacts created by hand.
 */
export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    platformContactId: text("platform_contact_id"),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    ...timestamps,
  },
  (t) => [
    unique("contact_account_platform_id_key").on(
      t.accountId,
      t.platformContactId,
    ),
    index("contact_account_id_idx").on(t.accountId),
  ],
);

/** A thread with a contact on a channel. */
export const conversation = pgTable("conversation", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contact.id, { onDelete: "cascade" }),
  // The platform's id for this thread. The core's idempotency key for
  // find-or-create; adapters never write it. Unique per channel.
  platformThreadId: text("platform_thread_id"),
  status: text("status")
    .$type<ConversationStatus>()
    .notNull()
    .default("open"),
  assigneeId: uuid("assignee_id").references(() => agent.id, {
    onDelete: "set null",
  }),
  unreadCount: integer("unread_count").notNull().default(0),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  unique("conversation_channel_thread_id_key").on(
    t.channelId,
    t.platformThreadId,
  ),
  index("conversation_account_id_idx").on(t.accountId),
  index("conversation_assignee_id_idx").on(t.assigneeId),
]);

/**
 * Normalised message. Nothing downstream reads the raw platform payload.
 * `platformMessageId` is the id the source platform assigned; it is unique
 * per channel so redelivered webhooks are idempotent. Outbound messages may
 * not have one yet, and Postgres treats NULLs as distinct, so that is fine.
 */
export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    direction: text("direction").$type<MessageDirection>().notNull(),
    authorType: text("author_type").$type<MessageAuthorType>().notNull(),
    authorAgentId: uuid("author_agent_id").references(() => agent.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull().default(""),
    attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
    platformMessageId: text("platform_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    // precision: 3 (milliseconds) is load-bearing, not cosmetic: the day 3
    // SSE cursor round-trips this column through a JS `Date`, which only
    // holds millisecond precision. Postgres `timestamptz`'s default is
    // microseconds, so without this a cursor built from a row's own
    // createdAt would compare as "less than" the row it came from (the
    // stored value has non-zero microseconds a Date can't carry) and the
    // stream would resend that row forever. Truncating storage to
    // milliseconds makes the round-trip exact. See docs/decisions.md.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("message_channel_platform_id_key").on(
      t.channelId,
      t.platformMessageId,
    ),
    index("message_account_id_idx").on(t.accountId),
    index("message_conversation_id_idx").on(t.conversationId),
  ],
);

/**
 * Append-only log of what happened to a conversation. Never updated or
 * deleted. Analytics and workflow automation both read this later.
 */
export const event = pgTable("event", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => account.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  type: text("type").$type<EventType>().notNull(),
  actorAgentId: uuid("actor_agent_id").references(() => agent.id, {
    onDelete: "set null",
  }),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("event_account_id_idx").on(t.accountId),
  index("event_conversation_id_idx").on(t.conversationId),
]);

export const accountRelations = relations(account, ({ many }) => ({
  agents: many(agent),
  channels: many(channel),
  contacts: many(contact),
  conversations: many(conversation),
}));

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  account: one(account, {
    fields: [conversation.accountId],
    references: [account.id],
  }),
  channel: one(channel, {
    fields: [conversation.channelId],
    references: [channel.id],
  }),
  contact: one(contact, {
    fields: [conversation.contactId],
    references: [contact.id],
  }),
  assignee: one(agent, {
    fields: [conversation.assigneeId],
    references: [agent.id],
  }),
  messages: many(message),
  events: many(event),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
  channel: one(channel, {
    fields: [message.channelId],
    references: [channel.id],
  }),
}));

export const eventRelations = relations(event, ({ one }) => ({
  conversation: one(conversation, {
    fields: [event.conversationId],
    references: [conversation.id],
  }),
}));
