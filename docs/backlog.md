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

## Agent inbox (noticed day 4)

- **No live updates on the agent side.** `/inbox` and a conversation view
  are ordinary page loads; a new inbound message from a customer doesn't
  appear until the agent navigates or refreshes. The widget already proves
  the SSE mechanism works both ways — this is "point a second, cookie
  -authenticated consumer at it," not a new mechanism.
- **Opening a conversation doesn't clear `unread_count`.** The badge on the
  list only clears when something else (another inbound/outbound message)
  recomputes it. Needs a small "mark read" write, deliberately left out to
  avoid adding a write path not asked for this session.
- **No "load older messages."** `listMessages` is properly paginated
  (`cursor`/`nextCursor`, rule 4) but the conversation page only ever
  renders the first page — there's no button wired to the next one yet.
- **Conversation list has no assignment, filters, search, or status change
  from the UI** — deliberately out of scope this session (see CLAUDE.md
  "what not to do" / this session's explicit rules), not forgotten.
- **One flaky test run.** `npm test` failed 2 of 44 once while a dev server,
  several manual curl calls, and Chrome automation were all hitting the same
  Neon connection concurrently; immediate re-runs were clean (twice). Never
  reproduced in isolation. Worth a closer look if it shows up in CI, where
  nothing else is competing for the connection.

## Production / deploy (noticed day 5)

- **No separate staging environment.** Production and local development
  point at the same Neon database, and `changeme123` test data (the "Yo"
  reply, the first "ship to Chiang Mai" thread) is live in it. Fine for a
  week-one demo; before real customers there needs to be a Neon branch (or
  a second project) for production, with previews on their own branch.
- **Vercel Authentication is now off entirely.** If a protected staging URL
  is ever wanted, use a preview deployment with protection on rather than
  toggling it on production.
- **Seeded demo conversation is slightly scruffy.** The older thread on the
  demo account still has a one-word "Yo" agent reply from day 4 testing. A
  10-second `update message set body=...` would tidy it; left alone to
  avoid editing production data without being asked.
- **SSE transient-drop reconnect is unverified end-to-end on live.** Server
  `Last-Event-ID` resume is proven and native `EventSource` reconnect works
  on a full reload, but "network blips for 5s, page auto-recovers" was not
  reproducible with the available tooling. Worth a manual DevTools-offline
  pass, or a Playwright test with `context.setOffline(true)`, before
  trusting it in front of an audience on flaky venue wifi.
- **`db/seed.ts` prints the plaintext password to stdout.** Convenient
  locally, but means the demo password lands in Vercel/CI build logs if the
  seed is ever run there. Not run in CI today; keep it that way, or make it
  print only when `process.stdout.isTTY`.
- **Neon `Pool` still never `end()`s in serverless** (already noted day 2) —
  no exhaustion seen under the light live smoke test, but nothing has
  actually load-tested it.

## Product (later days, listed so they are not lost)

- Channel adapters: LINE first (Thailand), then Messenger, Instagram,
  WhatsApp, Shopee, Lazada.
- `event`-table-driven analytics and workflow automation.
