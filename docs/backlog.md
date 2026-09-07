# Backlog

Things noticed while building that are out of scope for the milestone they
came up in. Not prioritised. One line each. Product-roadmap items live in
`docs/roadmap.md`, not here.

## Auth / identity

- Signup / invite flow — no UI creates an agent; the first one is seeded.
- Per-session revocation — stateless cookies mean rotating `SESSION_SECRET`
  is the only revoke, and it drops everyone. Consider a token-version column.
- `agent.email` is globally unique — the same person can't be an agent in two
  accounts. Would become `unique(account_id, email)` + account selection.
- Password rules, rate limiting, lockout on the login action.
- Session sliding expiry — currently a fixed 7-day window.
- The rotated-out demo password sits in git history (commit `2c86e30`).
  Harmless for a data-free account; rotate again and don't commit it if the
  account ever holds anything real.

## Data model

- Contact merge — `contact` needs a `merged_into_id` self-reference and a
  merge operation for when the same human appears on two channels.
- Confirm whether the inbox list sorts on `updated_at` or `last_message_at`
  and index accordingly.
- `NULLS NOT DISTINCT` on `message (channel_id, platform_message_id)` only if
  we ever need to forbid more than one null-id message per channel.
- `event` needs a monotonic sequence — ordering is `created_at` (ms) + a
  random uuid, which can't answer "created before message_received".
- `message.attachments` / `event.data` are untyped `jsonb` — consider a
  parse (zod) at the read boundary.

## Channels / message flow

- Website multi-thread — one visitor maps to one conversation forever; real
  widgets let a visitor start a new thread. Needs a thread id in the payload.
- Outbound delivery ordering — `sendReply` delivers through the adapter then
  writes the row; a crash between sends an unlogged message. Want an outbox /
  `pending → sent` status.
- Outbound reply idempotency — no dedupe on agent replies; a double-click
  writes two messages. Needs a client-supplied idempotency key.
- `message_sent` vs `replied` event types — both exist; pick one convention.
- Conversation-creation race — two messages for a brand-new thread arriving
  together can each write a `created` event. Harmless; an upsert-with-
  RETURNING or advisory lock fixes it.

### LINE (M1) deferrals

- LINE contact display name is hardcoded `"LINE user"` — fetch it from the
  profile API (`GET /v2/bot/profile/{userId}`) on contact creation.
- LINE inbound media (image/video/audio/file/sticker) becomes a placeholder
  body with no attachment — needs the content API (`GET /v2/bot/message/
  {id}/content`) plus blob storage, then real `NormalisedAttachment`s.
- LINE outbound is text-only and throws on an attachment-only reply.
- LINE group/room messages are skipped — 1:1 only. Group push uses a
  different `to` and reply semantics.
- LINE reply-token path unused (tokens expire ~30s); every reply is a push
  and counts against the monthly quota. Consider reply-token when the inbound
  message is fresh.
- `channelSecret` / `channelAccessToken` sit in `channel.config` plaintext
  like the widget token — roadmap M7 encrypts channel credentials at rest.
- No echo/self-message filtering for LINE (it doesn't echo push); Messenger
  will need it.

## Widget

- No visitor merge / no cross-device identity — clearing `localStorage`,
  switching browsers, or private mode starts a new contact and conversation.
- No "connecting…" first-paint state beyond the header dot.
- No typing indicator, no read receipts, no delivery-retry UI — a failed
  send just appends an inline error to the bubble text.
- No file / image upload when sending (received attachments do render).
- Widget CSS is unthemed — one fixed black/white palette, no customer
  branding.
- SSE poll cadence (1.5s) is a fixed constant — no backoff, no idle/active
  adjustment.

## Agent inbox

- No live updates on the agent side — a new inbound message needs a
  navigate/refresh. The widget already proves the SSE mechanism both ways;
  this is a second cookie-authenticated consumer, not a new mechanism.
- Opening a conversation doesn't clear `unread_count` — needs a small
  "mark read" write.
- No "load older messages" — `listMessages` paginates but the page only
  renders the first page.
- Conversation list has no assignment, filters, search, or status change
  from the UI.

## Tooling / infra

- `npm audit` reports 4 moderate issues, all from `esbuild` via `drizzle-kit`
  (dev-only, dev-server SSRF class). Revisit on the next `drizzle-kit` major.
- CI does not run `next build` — Vercel does it on deploy. Add to CI if we
  start breaking builds in ways typecheck misses.
- Seed script uses `node --experimental-strip-types` — fine on Node 22; swap
  for `tsx` or a build step if it gets fragile.
- Neon `Pool` is never `end()`ed in serverless — no exhaustion seen under
  light load; nothing has load-tested it.
- pglite doesn't reproduce Neon's driver-level wire marshalling — the
  timestamp-precision bug (see `decisions.md`) passed 35 pglite tests and
  only showed up against real Neon. Don't trust the pglite suite alone on
  timing-sensitive logic.
- One flaky test run (2 of 44) under heavy concurrent load on the shared Neon
  connection; never reproduced in isolation. Look closer if it shows in CI.

## Production / deploy

- No separate staging environment — production and local share one Neon
  database, with scruffy test data live in it. Before real customers: a Neon
  branch (or second project) for production, previews on their own branch.
- Three scruffy test conversations on the demo account — left alone rather
  than editing production data unasked; the runbook starts a fresh one.
- SSE transient-drop reconnect is unverified end-to-end on live — server
  `Last-Event-ID` resume and native reconnect-on-reload are both proven, but
  "wifi blips for 5s, page auto-recovers" wasn't reproducible with the
  available tooling. Worth a manual DevTools-offline pass, or a Playwright
  test with `context.setOffline(true)`.
