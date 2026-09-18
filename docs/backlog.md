# Backlog

Things noticed while building that are out of scope for the milestone they
came up in. Not prioritised. One line each. Product-roadmap items live in
`docs/roadmap.md`, not here.

## Auth / identity

- Never-verified signups and never-accepted invites accumulate — both are
  `account`/`agent` rows written before `email_verified_at` is set (M4, M6).
  Add a sweep that deletes them after N days; for invites, also frees a
  mistyped-but-never-cancelled email.
- Signup says "that email is already registered" (M4) and invite says "that
  email already has a One Inbox account" (M6) — both a mild
  account-enumeration vector for someone probing addresses. The
  privacy-preserving alternative is to always say "check your inbox" and
  email an explanatory note when the address turns out to be taken. Weigh
  against the worse UX for both flows together.
- Global logout is still only "rotate `SESSION_SECRET`" (drops everyone).
  Per-*agent* revocation now exists (`agent.session_epoch`, M3); a full
  `session` table for device-level control is still out (needs sign-off —
  it is the eighth table).
- `agent.email` is globally unique by deliberate choice (M6 resolved the M3
  deferral this way — see docs/decisions.md). One person can't be an agent
  in two accounts. Real multi-account membership would need
  `unique(account_id, email)` + an account picker at login, or a membership
  table (the eighth table) — a bigger change than "basic roles" called for.
- Admins can be invited but cannot themselves invite, cancel, or resend —
  only `owner` can (M6). Letting `admin` do the same is a small, deliberate
  follow-up, not done here.
- No "remove an active teammate" — `cancelInvite` (M6) only ever deletes a
  still-pending row by design. Removing someone real needs to reassign their
  conversations/assignments first; a separate feature.
- Rate limiting and lockout on the login, signup, forgot-password, and
  invite actions; password complexity beyond M4's 8-character minimum.
- Three signed-token modules now: `lib/session.ts`, `lib/verification.ts`,
  and `lib/signed-token.ts` (M5's shared primitive). Fold the first two onto
  the third — `session.ts` needs its `epc` payload carried through.
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
- No echo/self-message filtering for LINE (it doesn't echo push); Messenger
  will need it.

### WhatsApp (M12) deferrals

- No settings UI — a WhatsApp channel can only be created by inserting a
  `channel` row directly (as done for the pipeline tests). Extending
  `/settings/channels` to a second channel type (a connect form, a
  `connectWhatsAppChannel`-style function, `phoneNumberId`/`accessToken`/
  `appSecret`/`verifyToken` fields) is real, separate scope.
- Not verified against real Meta infrastructure — no real WhatsApp Business
  number, app secret, or public webhook URL was available this session.
  Boris/Jesper's checkpoint, same as M1's live LINE round-trip.
- WhatsApp inbound media (image/video/audio/document/sticker) becomes a
  placeholder body with no attachment — needs a second authenticated call
  to fetch the media URL by id, plus blob storage, then real
  `NormalisedAttachment`s. Same shape as LINE's equivalent deferral.
- WhatsApp outbound is text-only and throws on an attachment-only reply.
- No handling for WhatsApp's 24-hour customer-service-window rule — a send
  outside that window (without a pre-approved template message) will just
  surface as an `OutboundDeliveryError` from the platform's own rejection,
  with no template-message fallback built.
- No `messaging_product`/`statuses` (delivery/read receipt) handling —
  `parseInbound` only reads `value.messages`; status updates for our own
  outbound sends are ignored, not stored anywhere.

### Messenger and Instagram (M12 continued) deferrals

- No settings UI — same gap as WhatsApp's. A `messenger`/`instagram`
  channel can only be created by inserting a `channel` row directly.
- Not verified against real Meta infrastructure — no real Facebook Page,
  Instagram Business account, or public webhook URL was available this
  session. Boris/Jesper's checkpoint.
- No profile-name enrichment — the webhook carries no display name for
  either platform; contacts show as generic "Facebook user"/"Instagram
  user" until a `GET /{psid}?fields=first_name,last_name`-style call (and
  the extra permission it needs) is added.
- Both are text-only outbound and inbound-attachment-only messages
  (image/sticker/audio/etc.) are skipped entirely rather than shown as a
  placeholder — no attachment CDN-URL resolution built.
- No delivery/read receipt handling — `messaging` items with no
  `message.mid` (postbacks, receipts) are silently skipped.

### Settings/integrations (M7) deferrals

- ~~`CHANNEL_CREDENTIALS_KEY` not set in Vercel~~ — set 2026-09-15. Connecting
  a real channel on the live deployment should work now (not re-verified
  live since).
- ~~No reconnect / no visible connection status~~ — shipped in M8: enable/
  disable, last-inbound and last-error status, and a credentials-replace
  ("Reconnect") action.
- One LINE channel per account is allowed today (no uniqueness enforced,
  also no reason yet to want two) — revisit if a real use case shows up.
- `CHANNEL_CREDENTIALS_KEY` rotation makes every connected channel's
  credentials undecryptable, same trade-off as `SESSION_SECRET` rotation
  dropping every session. No re-encryption/rotation tooling exists.

### Per-tenant channel management (M8) deferrals

- No "remove/delete" a channel at all — only enable/disable. Deleting one
  with real conversation history hanging off it (`message.channel_id` etc.)
  is a materially bigger, riskier feature than pausing it; not attempted.
- No UI edit for a channel's *name* — only its credentials (Reconnect) and
  its enabled state.
- `lastError` only ever comes from an outbound send failure — an inbound
  webhook that fails signature verification is not recorded anywhere
  per-channel (deliberately, to avoid false alarms from URL scanning/
  probing — see docs/decisions.md). If real "webhook keeps failing"
  debugging is ever needed, that's a different, opt-in feature.
- No notification (email, etc.) when `lastError` is set — the owner has to
  visit `/settings/channels` to notice a channel is failing. Fine for one
  channel and one owner today; revisit if that stops being true.
- Disabling a channel does not hide its existing conversations from the
  inbox — they stay fully visible, but an agent typing a reply only finds
  out it's blocked (403) on send, with nothing in the conversation view
  itself hinting the channel is paused. Revisit if that's ever confusing.

## Billing (M9)

- No feature gating on `account.plan` anywhere — deliberately out of scope
  for M9 ("just the plumbing"). Deciding what "pro" actually unlocks is a
  real product call for later.
- `past_due`/`unpaid`/`incomplete*` all read as "free" immediately, no
  grace period. A placeholder policy with zero effect today since nothing
  checks `plan` yet; revisit once something does.
- No handling for `invoice.payment_failed` or any other Stripe event beyond
  the three checkout/subscription ones — currently a silent 200 no-op for
  anything else. Add more as real behaviour needs them.
- The test-mode "One Inbox Pro (TEST placeholder)" Price
  (`price_1UGEBrIUMKnEHi7P54NkAjn6`, $29/mo) created to exercise checkout
  is a stand-in, not a pricing decision — replace `STRIPE_PRICE_ID` (and
  archive/rename the placeholder in Stripe) once real pricing exists.
- No multi-seat / per-agent pricing consideration yet — one plan per
  account, flat. Not asked for; note it in case it becomes relevant.

## Broadcast (M13) deferrals

- No broadcast history — fire-and-forget by deliberate choice (no eighth
  table). There's no way to see "what did we send last week" or "who did
  this broadcast reach" after the one-time results summary on `/broadcast`
  disappears. A `broadcast` (+ recipient status) table would need asking.
- No contacts directory reused here on purpose — `listBroadcastTargets` is
  broadcast-specific target resolution, not the M11-backlogged "browsable
  contacts list." A real contacts directory is still a separate feature.
- Sequential sends only — a broadcast to hundreds of contacts would be slow
  (one real API call at a time) and has no batching/rate-limit awareness for
  any platform's send limits (WhatsApp's 24-hour window rejections included).
- No idempotency — resubmitting the same broadcast (e.g. a double click)
  sends it twice; same class of gap as ordinary reply idempotency, above.
- No way to exclude a channel type or filter the contact list beyond "look
  at the checkbox list" — fine at low contact counts, not at real scale.

## Contact/CRM (M11) deferrals

- No contacts directory/list page — the only way to reach a contact profile
  is via a conversation's header link. Roadmap M11 only asked for the
  profile itself; a browsable list is a real, separate feature.
- No contact merge UI — already tracked under "Data model" above
  (`merged_into_id`). M11's cross-channel history works once two
  conversations point at the same `contact.id`; nothing creates that link
  automatically yet.
- No manual "create a contact" (e.g. add a note before they've messaged in)
  — every contact today is created by an inbound message.
- Notes are a single free-text field with no edit history and no author —
  overwritten wholesale on every save, last writer wins, no audit trail.
- No editing a contact's email/phone from the UI — those are only ever set
  by an adapter's `parseInbound` payload.

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

- Channel tags are one uniform style — no per-channel colour/icon (e.g. LINE
  green). A brand-aware `ChannelTag` is a real feature; deferred to keep the
  UI free of `channel.type` branching (M2).
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
- Nothing runs `db:migrate` automatically — not CI, not the build. A schema
  migration has to be applied to Neon by hand before/with the deploy that
  needs it, or the new code 500s. Wire a migrate step (release command or CI
  job) before a second person is deploying.
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
- Every suite builds its own pglite in `beforeEach`; `hookTimeout` is now 30s
  to absorb parallel WASM init on a loaded machine (M2). A shared per-file or
  global fixture, or capping workers, would be the real fix.

## Production / deploy

- No separate staging environment — production and local share one Neon
  database, with scruffy test data live in it. M3 left a runbook
  (docs/decisions.md): Neon branch for production, previews on `main`. As of
  2026-09-15: the owner already has a Neon branch named "production", but it
  isn't confirmed yet whether that's a genuinely separate/unused branch or
  just the name of the one branch everything (local + live) already uses —
  checking the Neon console (Branches tab + each branch's connection host)
  is the next step, still on the owner. Once confirmed, Claude still needs
  to run migrations against the new branch before the Vercel `DATABASE_URL`
  switches over.
- ~~`RESEND_API_KEY` / `EMAIL_FROM` not set in Vercel~~ — set 2026-09-15.
  Confirmed working as designed: a live test send to a non-owner address
  was correctly rejected by Resend with `403 validation_error` — the
  `onboarding@resend.dev` sandbox sender only delivers to the email the
  Resend account itself is registered under, by Resend's own policy, not a
  bug here. That failure is now logged server-side too (commit `e4aba65`),
  which is how it was actually diagnosed. Still needed before real users can
  receive mail: a verified domain in Resend, `EMAIL_FROM` updated to use it.
- ~~`STRIPE_WEBHOOK_SECRET` is a self-signed placeholder~~ — set 2026-09-16.
  Real Stripe-issued secret, endpoint added in the Stripe dashboard pointing
  at `/api/billing/webhook`, confirmed live: an unsigned request correctly
  gets `401`, and a genuine Stripe-signed `customer.subscription.created`
  event (from a throwaway test customer/subscription, deleted after)
  processed with `200`.
- Scruffy test conversations on the demo account — left alone rather than
  editing production data unasked; the runbook starts a fresh one. M3's live
  SSE check added one more ("SSE reconnect check …").
- SSE transient-drop: the socket itself being dropped by the OS/browser (vs.
  an explicit `fetch`/`EventSource` close) is still only exercised by native
  `EventSource` behaviour, not a test. M3 verified everything up to that line
  live (reconnect + `Last-Event-ID` resume, no drop, no dupe). A Playwright
  test with `context.setOffline(true)` would close the last inch.
