# Backlog

Things noticed during day 1 that are out of scope for day 1. Not prioritised.

## Auth / identity

- **Signup / invite flow.** There is no UI to create an agent; the first one
  is made with `npm run db:seed`. Need an invite-by-email flow and an
  "add teammate" screen scoped to the account.
- **Per-session revocation.** Sessions are stateless signed cookies, so the
  only way to revoke is to rotate `SESSION_SECRET` (drops everyone). Consider
  a token version column on `agent`, or revisit the seven-table limit.
- **Agent email is globally unique.** The same person cannot be an agent in
  two accounts. Revisit if that becomes a real requirement (would move to
  `unique(account_id, email)` plus account selection at login).
- **Password rules / rate limiting / lockout** on the login action.
- **Session refresh / sliding expiry.** Cookie is a fixed 7-day window.

## Data model

- **Contact merge.** `contact` will need a `merged_into_id` self-reference
  and a merge operation when the same human appears on two channels.
- **Conversation `updated_at` vs `last_message_at`.** Confirm which one the
  inbox list sorts on and index it accordingly.
- Consider `NULLS NOT DISTINCT` on `message (channel_id, platform_message_id)`
  only if we ever need to forbid more than one null-id message per channel
  (currently we want to allow it for outbound-before-ack).

## Tooling / infra

- **`npm audit`** reports 4 moderate issues, all from `esbuild` pulled in
  transitively by `drizzle-kit` (dev-only, dev-server SSRF class). Upstream
  fix pending; revisit on the next `drizzle-kit` major.
- **CI does not run `next build`.** Vercel does it on deploy; add it to CI if
  we start breaking builds in ways typecheck misses.
- **Seed script uses `node --experimental-strip-types`.** Fine on Node 22;
  swap for a build step or `tsx` if it becomes fragile.
- Decide websocket-free presence / "agent is typing" approach when we build
  the inbox UI.

## Channels / message flow (noticed day 2)

- **Per-platform webhook signature verification.** The inbound endpoint uses
  a shared `x-channel-token` from `channel.config`. LINE signs with
  HMAC-SHA256 of the raw body, Messenger with `X-Hub-Signature-256`. Needs a
  real home (adapter capability or endpoint strategy) before LINE.
- **Website multi-thread.** One visitor currently maps to one conversation
  forever. Real widgets let a visitor start a new thread ("new conversation")
  and show history. Add a thread id to the widget payload.
- **Outbound delivery ordering.** `sendReply` delivers through the adapter
  *then* writes the row. For real channels a crash in between sends an
  unlogged message. Want an outbox / `pending → sent` message status.
- **Conversation-creation race.** Two different messages for a brand-new
  thread arriving together can each write a `created` event. Harmless but
  untidy; an upsert-with-RETURNING or advisory lock would fix it.
- **`event` needs a monotonic sequence.** Ordering is `created_at` (ms
  precision) + a random uuid. Analytics that cares about "created before
  message_received" needs a `bigserial` sequence or per-conversation counter.
- **Outbound reply idempotency.** No dedupe on agent replies; a double-click
  writes two messages. Needs a client-supplied idempotency key (day 4 UI).
- **`message_sent` vs `replied` event types.** Both exist; `ingestInbound`
  uses neither for outbound, `sendReply` uses `replied`. Pick one convention.
- **Neon `Pool` lifecycle in serverless.** We never call `pool.end()`. Fine
  at low volume; revisit if we see connection exhaustion on Vercel.
- **`message.attachments` / `event.data` are untyped `jsonb`.** Consider a
  parse (zod or hand-rolled) at the read boundary.

## Widget (noticed day 3)

- **pglite doesn't reproduce Neon's timestamp wire precision.** The
  `created_at` cursor-precision bug (see decisions.md) passed all 35 tests
  against pglite and only showed up testing against real Neon over the
  actual driver. Worth remembering next time timing-sensitive logic is
  "proven" by the pglite suite alone — it's real Postgres, but not
  necessarily the same driver-level marshalling as production.
- **No visitor merge / no cross-device identity.** Clearing `localStorage`,
  switching browsers, or private mode all start a brand-new contact and
  conversation. Same limitation as day 2's contact-merge gap, sharper now
  that there's a real client minting ids.
- **Widget has no "connecting…" first-paint state** beyond the header dot;
  a slow first load shows an empty message list with no affordance.
- **No typing indicator, no read receipts, no delivery retry UI** — a
  failed send just appends an inline error string to the bubble text.
- **No file/image upload from the widget.** `attachments` render if a
  received message has them; there's no way to attach one when sending.
- **Widget CSS is unthemed** — single fixed black/white palette, no way for
  a customer to brand it. Fine for week one, not for a real embed.
- **SSE stream reconnect cadence (1.5s poll) is a fixed constant.** No
  backoff, no adjustment for idle vs active conversations. Fine at the
  current scale; revisit if polling becomes a real DB load.

## Product (later days, listed so they are not lost)

- Channel adapters: LINE first (Thailand), then Messenger, Instagram,
  WhatsApp, Shopee, Lazada.
- `event`-table-driven analytics and workflow automation.
