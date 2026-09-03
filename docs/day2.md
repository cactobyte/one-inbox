# Day 2 — channel adapters and message flow

Day 1 was the skeleton. Day 2 is the first channel actually moving messages
in and out, built so the interface fits LINE/Messenger/WhatsApp without a
rewrite.

## Commits (in order)

1. `Switch db client to the Neon WebSocket pool driver` — enables real
   transactions (the ingest path needs them). Anticipated in day 1's
   questions.md. Adds `@electric-sql/pglite` (dev) for tests.
2. `Add the channel adapter interface` — `lib/channels/message.ts`,
   `lib/channels/adapter.ts`.
3. `Add the website channel adapter and the adapter registry` —
   `lib/channels/website/adapter.ts`, `lib/channels/registry.ts`.
4. `Add platform-identity columns for idempotent find-or-create` — migration
   `0001`, `contact.platform_contact_id` + `conversation.platform_thread_id`.
5. `Add the inbound ingestion endpoint` — `lib/inbox/ingest.ts`,
   `lib/http.ts`, `app/api/channels/[channelId]/inbound/route.ts`, seed now
   creates a widget channel.
6. `Add the outbound reply path` — `lib/inbox/reply.ts`,
   `app/api/conversations/[conversationId]/messages/route.ts`.
7. `Tests: idempotency and account isolation, on real Postgres` — pglite
   harness in `test/db.ts`, 24 tests total.
8. `docs` — this file, decisions, backlog.

## The adapter contract

`ChannelAdapter` (`lib/channels/adapter.ts`) has **exactly two** methods:

- `parseInbound(payload, config) → InboundMessage` — pure, validates, throws
  `InvalidPayloadError` on junk.
- `sendOutbound(message, config) → SendResult` — delivers to the platform.

The normalised model (`lib/channels/message.ts`) names no channel. The person
and thread are opaque `platformId` strings. `lib/channels/registry.ts`
(`getAdapter`) is the **only** place that maps a channel type to behaviour —
grep the repo for `"widget"` and you'll find it in the registry and the seed,
nowhere else.

### Website adapter

- Payload: `{ messageId, visitorId, visitorName?, visitorEmail?, text,
  attachments?, sentAt? }`. `messageId` is the idempotency key.
- v1: one visitor = one thread (`thread.platformId = visitorId`).
- `sendOutbound` calls no API and returns a null platform message id — the
  widget will pull outbound messages via the real-time layer (day 3+). This
  is correct behaviour for a pull channel, not a stub.

## Inbound flow

`POST /api/channels/:channelId/inbound`
→ resolve channel + account from the path
→ check `x-channel-token` against `channel.config.inboundToken`
→ `adapter.parseInbound`
→ `ingestInbound` in **one transaction**:
  dedupe on `(channelId, platformMessageId)` ·
  upsert `contact` by `platform_contact_id` ·
  find-or-create `conversation` by `platform_thread_id` (+ `created` event) ·
  insert `message` · insert `message_received` event ·
  bump `unread_count` / `last_message_at` ·
  (an inbound on a resolved conversation reopens it + `reopened` event)

Responses: `201` created · `200` `{status:"duplicate"}` · `400` bad payload ·
`401` bad token · `404` unknown channel. Idempotent: the same `messageId`
twice writes nothing the second time.

## Outbound flow

`POST /api/conversations/:conversationId/messages` (agent session cookie)
→ `sendReply`: load conversation **scoped to the agent's account** (a
conversation id from another account → `404`), resolve channel,
`adapter.sendOutbound(...)`, then in one transaction write the outbound
`message`, a `replied` event, and reset `unread_count`.

## Tests (24, all in CI)

`test/db.ts` boots pglite (real Postgres, in-process) with the checked-in
migrations. Key ones:

- **`ingestInbound` — same payload twice → exactly one `message` row** and one
  `created` + one `message_received` event.
- **Account isolation** — identical widget payloads on two accounts produce
  separate contacts/conversations; `sendReply` from an agent in account B
  into account A's conversation throws `NotFoundError` and writes nothing.
- Website adapter normalisation + every validation failure path.

## What you should check first

1. `docs/decisions.md` → Day 2 section. The two calls most worth challenging:
   **platform identity as columns on `contact`/`conversation`** rather than a
   mapping table (seven-table limit), and **inbound webhook auth is a shared
   token**, not per-platform signature verification (deferred to when LINE
   lands — in the backlog).
2. `lib/channels/adapter.ts` — confirm the two-method interface has no
   website assumptions and would fit LINE.
3. `lib/inbox/ingest.ts` — the transaction and the duplicate-race handling.
4. Try it: `npm run dev`, then `npm run db:seed` prints a channel id + token,
   then POST a widget message (see the seed output for the exact curl).

## Try it locally

```
npm run db:seed        # prints: channel id, inbound token, the POST url
# then, with those values:
curl -X POST http://localhost:3000/api/channels/<CHANNEL_ID>/inbound \
  -H "x-channel-token: <TOKEN>" -H 'content-type: application/json' \
  -d '{"messageId":"m1","visitorId":"v1","visitorName":"Nok","text":"Hi"}'
# same command again → {"data":{"status":"duplicate",...}}
```

Migration `0001` has been applied to the Neon database. The seed created a
`Website` channel on the existing account.

## Not done (later days, in backlog.md)

Chat widget, inbox UI, conversation/message **list** endpoints, per-platform
webhook signatures, website multi-thread, outbound delivery ordering, any
other channel adapter.
