# Decisions

Architecture and design calls, with what was rejected and why. Two to four
lines each. Append a new entry per milestone; don't rewrite old ones.

Bug lessons worth keeping are marked **Lesson**. The full write-ups are in
git history (this file used to carry them at length).

---

## 2026-09-03 · Foundations

**Database — Postgres (Neon).** The model is relational with hard integrity
needs: `account_id` on every row, foreign keys, and a uniqueness constraint
that blocks duplicate webhook deliveries — all enforced in the database, not
app code. Neon because it is serverless (matches Vercel) and branchable (a DB
branch per preview later). Rejected: a document store (integrity moves to app
code) and SQLite (no serverless story, weak concurrent-writer story).

**ORM — Drizzle.** TypeScript-first schema with real inferred row types;
SQL-first migrations generated as plain `.sql` and checked into
`db/migrations`, so what runs against production is reviewable. Rejected:
Prisma (extra engine binary, opaque migrations); hand-written SQL (no type
link, and the model changes every month).

**Real-time — Server-Sent Events, not WebSockets.** Inbox traffic is almost
entirely server → client; the rare client → server events already go through
POST. SSE is plain HTTP (passes proxies, `EventSource` auto-reconnects, fits
Vercel streaming). WebSockets on Vercel need a separate always-on service,
breaking "one Next.js app + one Postgres". Per CLAUDE.md, not to be revisited.

**Sessions — stateless HMAC-signed cookie, no table.** A `session` table
would be an eighth table (needs sign-off). Cookie is `{ sub: agentId, exp }`
signed with `SESSION_SECRET`, 7-day fixed expiry. Trade-off: revocation is
coarse — rotating the secret drops everyone. Per-session revocation: backlog.

**Password hashing — Node `crypto.scrypt`.** Memory-hard, standard library,
no native build, no new dependency. Rejected: `bcryptjs` (extra dep),
`argon2` (native build, painful on Windows + Vercel).

**Enum-like columns — `text` + a TypeScript union, not a Postgres enum.**
`channel.type`, `event.type`, conversation status. A new channel ships
monthly; widening a real enum is a migration every time, a text column is
not. Integrity that matters (FKs, the dedupe constraint) is still in the DB.

**Schema shape.** Every non-`account` table has
`account_id NOT NULL REFERENCES account(id) ON DELETE CASCADE`.
`message` has `UNIQUE(channel_id, platform_message_id)` (nullable id, NULLs
distinct, so unacked outbound is fine). `event` is insert-only.

---

## 2026-09-03 · Channel adapters and message flow

**Adapter interface — exactly two methods.** `parseInbound(payload, config)`
and `sendOutbound(message, config)`, nothing else. The normalised model names
no channel; person and thread are opaque platform-id strings the core stores
but never interprets. Signature verification, retry and echo-filtering are
deliberately not on the interface. Rejected: a `verify()` / `handleWebhook()`
method (makes "exactly two things" false, leaks transport into every adapter).

**Platform identity — columns, not a mapping table.**
`contact.platform_contact_id` (unique per account) and
`conversation.platform_thread_id` (unique per channel), both nullable. A join
table would be an eighth table. Trade-off: a contact is tied to whichever
account first saw that platform id; cross-channel identity and merge are
unsolved (backlog).

**DB driver — Neon serverless `Pool` (WebSocket), not `neon-http`.**
`neon-http` has no interactive transactions; the inbound path writes contact
+ conversation + message + event atomically. Build-without-`DATABASE_URL` and
lazy client creation are kept.

**Idempotency — unique index first, race caught second.** `ingestInbound`
checks for the existing message inside the transaction and returns
`status: "duplicate"`. If two identical webhooks race, the loser's `INSERT`
hits `UNIQUE(channel_id, platform_message_id)`, the transaction rolls back,
the caller re-reads the committed row and still returns `duplicate`.

**Website adapter — one visitor is one thread; `sendOutbound` is a real
no-op.** `thread.platformId = visitorId` (the widget doesn't track threads).
`sendOutbound` calls no API and acks with a null platform message id — the
widget *pulls* outbound messages through the real-time layer. This is how a
pull channel actually behaves, not a stub. Multi-thread: backlog.

**Inbound webhook auth — shared per-channel token, for now.** The endpoint
checks `x-channel-token` against `channel.config.inboundToken` (constant
time). Real platforms sign webhooks per-platform (LINE: HMAC-SHA256 of the
body; Messenger: `X-Hub-Signature-256`); that needs a home before LINE lands
— likely an adapter capability or an endpoint strategy keyed on channel type.
Backlog.

**Tests — pglite, not mocks.** `@electric-sql/pglite` (dev dep) gives an
in-process real Postgres, so the dedupe index and every `account_id` filter
run for real in CI. Rejected: a fake in-memory repository (proves nothing);
hitting Neon from CI (needs secrets, flaky).

---

## 2026-09-04 · The website widget

**Visitor identity — a random UUID in `localStorage`.** Minted on first load,
stored under `oneinbox:visitor:<channelId>` on the host page's origin (the
widget is not iframed). Reused on reload so `platform_thread_id` keeps
mapping to the same conversation. Rejected: a cross-site cookie (ITP already
blocks it, Chrome is heading there); a server-minted id (extra round trip for
a value that is a thread key, not a credential); fingerprinting (worse for
privacy, unnecessary). Trade-off: private mode / storage-blocking falls back
to an in-memory id for that page load; no visitor-merge story (backlog).

**The channel token is public once it ships in a browser.** It sits in the
widget's `data-token` attribute — like a Stripe *publishable* key. Its job is
"which channel", not authorisation. No code changed; this is a naming so
nobody later reaches for it as a real secret.

**CORS — the two widget-facing endpoints only.** `lib/cors.ts`, wildcard
origin (neither endpoint uses cookies — the channel token is the only
credential), on the inbound POST and the SSE stream GET. Deliberately *not*
on `/api/conversations/*` — those are cookie-authenticated and same-origin;
permissive CORS there would be a real hole.

**SSE resume — `Last-Event-ID` is native; the server just honours it.**
`EventSource` resends the last event `id` on reconnect. The server polls
Postgres every 1.5s for messages after a `(created_at, id)` cursor
(`lib/inbox/cursor.ts`) — no queue, no pub/sub (ruled out by CLAUDE.md) — and
ends the stream every 5 minutes so a Vercel function timeout looks like an
ordinary drop the client already recovers from.

> **Lesson — timestamp precision.** `created_at` defaulted to microsecond
> precision but the driver returns millisecond-only `Date` objects, so a
> cursor built from a row and round-tripped through `Date` compared as *less
> than* its own row — the stream resent the newest message forever. Fixed
> with `timestamptz(3)` (migration `0002`). 35 pglite tests were green
> throughout; pglite doesn't reproduce Neon's wire precision (backlog).

**Widget shell — one `<script type="module">`, config from `data-*`.**
Module scripts don't set `document.currentScript`, so config is read via
`document.querySelector('script[data-channel-id][data-token]')`; the API
origin is derived from that script's own resolved `src`, so the bundle isn't
tied to one deployment. Compiled by plain `tsc` (no bundler, no new dep) to
`public/widget/*.js` at build time (`predev` / `prebuild`), gitignored.

> **Lesson — ESM import extensions.** `tsc` doesn't rewrite extensionless
> relative imports for real ESM output, so `widget/src/*.ts` must import its
> siblings with an explicit `.js` (`from "./ui.js"`). `tsc --noEmit` is
> silent about this either way; it only shows up loading the built output in
> a browser.

**Message reconciliation — optimistic send + SSE echo, deduped by id.** The
widget renders its own message immediately with the client-generated id it's
about to POST. The SSE stream carries *all* messages on the conversation, so
that message comes back; the widget matches by id and replaces the pending
bubble instead of appending. The stream is the single source of truth either
way, so this avoids a second "is this confirmed" code path.

> **Lesson — one message, two ids.** The stream first sent the database row
> id as identity, but the widget keys its optimistic bubble on the
> client-generated id, so reconciliation silently never matched for a
> visitor's own messages and they rendered twice after a reconnect. Fixed:
> the stream sends `platformMessageId ?? id` (an agent reply has no
> client id, which is exactly when the row id is the right identity).
> Regression test in `lib/inbox/stream.test.ts`.

---

## 2026-09-05 · Agent inbox

**Account scoping lives in the query functions.** `listConversations`,
`getOwnedConversation`, `listMessages` (`lib/inbox/queries.ts`) each take
`accountId` as a required argument and put it in the `WHERE` clause. A
foreign conversation id is never returned — not filtered out later, not
hidden by the page. `getOwnedConversation` throws `NotFoundError` rather than
returning `null`, so a foreign id and a made-up id are indistinguishable.

**List + detail are two server-rendered routes**, `/inbox` and
`/inbox/[conversationId]`, with an ordinary link between them — not a
client-side split view sharing state. Far less code; nothing asked for a SPA.
Reconsider if agents complain about the round trip.

**No live updates on the agent side yet.** A reply lands via
`router.refresh()` after the POST resolves; the inbox does not watch its own
stream. The task only required the reply reach the *widget* live. An
agent-side SSE consumer is a real, separate addition — backlog.

**The reply form calls the existing endpoint over HTTP.** `ReplyForm`
`fetch()`s `POST /api/conversations/:id/messages` — the exact endpoint that
already exists. Rejected: a server action calling `sendReply` directly — one
call shorter, but a second entry point into the same behaviour with its own
request lifecycle.

**Pagination reuses day 3's cursor codec**, keyset on `(timestamp, id)`,
newest-first (`<` instead of `>`). Same problem, opposite direction; no
change to `cursor.ts`.

**Last-message preview — a correlated scalar subquery**, not a
denormalised `last_message_body` column kept in sync on every write. One
index-backed lookup per row on a page of ~30 — trivial here, and nothing to
keep consistent by hand. Revisit only if the list query shows up as slow.

---

## 2026-09-06 · Production / demo readiness

No application code changed except one string in `db/seed.ts`.

**Vercel deployment protection was on — turned off.**
`ssoProtection: { enabled: false }`. Standard Protection put a Vercel login
wall in front of the whole app, and — worse — `401`'d every cross-origin
widget call (`POST /inbound`, the SSE stream) before it reached our code. A
website widget is worthless behind an SSO wall. For a protected staging URL
later, use a preview deployment with protection on, not production.

**Seeded demo password — no hardcoded default, value not committed.**
`db/seed.ts` now *requires* `SEED_AGENT_PASSWORD` and exits if unset, the
same way it treats `DATABASE_URL` — swapping one guessable literal in public
source for another isn't the fix. A fresh value was set directly on the
production Neon DB (the deploy shares that one database) and shared out of
band; `docs/demo.md` carries a placeholder. A superseded value remains in git
history — acceptable for a throwaway credential on a data-free account
(backlog). Real auth hardening (rotation, rate limiting, lockout): backlog.

**Production env / DB — verified, nothing to change.** Login against
production succeeds (`SESSION_SECRET` signs and verifies); `/inbox` and the
inbound webhook read/write the production Neon DB (`DATABASE_URL`). The
serverless `Pool` held up across the live smoke test. The session cookie is
`Secure` + `SameSite=Lax`, correct for the same-origin agent login; the
widget deliberately uses no cookies.

**SSE resume — verified server-side on the live deployment.** A fresh stream
replays the conversation with an `id:` cursor on every event; reconnecting
with `Last-Event-ID` returns zero message events (no replay, no dupes, no
drops); a full widget reload replays history once, deduped by id. Not
exercised: a *transient* network blip triggering native `EventSource` retry
in the page — the browser tooling has no offline toggle (backlog).

---

## 2026-09-07 · M1 — LINE adapter

**`parseInbound` now returns `InboundMessage[]`, not one message.** A LINE
webhook body is `{ events: [...] }` and routinely carries several messages in
one delivery (a customer firing off two lines); Messenger batches the same
way. Returning one message would silently drop the rest — the exact
"duplicate/dropped messages" bug CLAUDE.md calls out. The fan-out cannot live
in the route without the route knowing LINE's envelope shape (breaks rule 2),
so the adapter returns all of them. The website adapter returns a one-element
array; the inbound route loops `ingestInbound` and reports a `results[]`.
This is the interface change M1 was allowed to make with a written reason.
Rejected: an optional `parseInboundBatch` (two ways to parse, and the thing
the Foundations note warned against).

**Webhook verification — a registry keyed on channel type, not an adapter
method.** `lib/channels/verify.ts`, same shape as the adapter registry: LINE
→ HMAC-SHA256 of the raw body against `x-line-signature`; everything else →
the existing shared-token check. This is the "endpoint strategy keyed on
channel type" the day-2 note predicted. Keeps `ChannelAdapter` at exactly two
methods (Foundations explicitly rejected a `verify()` method on the
interface). The route now reads the body with `request.text()` so the HMAC
sees the exact bytes, then `JSON.parse`s it.

**Outbound — push API, not reply tokens.** `POST /v2/bot/message/push` with
the channel access token. LINE's free reply token expires ~30s after the
inbound message; an agent inbox replies minutes later, so reply tokens are
unusable here. Trade-off: push messages count against the monthly quota.
Delivery still happens before the DB write (same as the website path); an
outbox is still in the backlog.

**M1 scope limits, all in the backlog.** 1:1 user chats only (group/room
messages are skipped — different push semantics). Text only: inbound media
becomes a `[sticker]`/`[image]` placeholder with no attachment (fetching LINE
media needs a second authenticated call plus blob storage); outbound is
text-only and rejects an attachment-only reply. Contact display name is
`"LINE user"` — the real name needs a profile API call, which does not belong
in a pure `parseInbound`.

**No migration.** `channel.type` already allowed `"line"`, `channel.config`
is `jsonb`, and contact/conversation/message are channel-agnostic by design.
The LINE channel's `channelSecret` and `channelAccessToken` sit in
`channel.config` in plaintext, exactly as the widget's `inboundToken` does;
roadmap M7 moves channel credentials to encrypted per-tenant storage.

**Redelivery.** LINE resends webhooks on our 5xx. Idempotency is unchanged:
the key is LINE's `message.id` → `message.platform_message_id`, stable across
a redelivery, so `ingestInbound` returns `duplicate` and writes nothing.
`deliveryContext.isRedelivery` needs no special handling.

**Not verified live.** A real LINE OA round-trip (real channel secret +
access token, public webhook URL) is Boris/Jesper's checkpoint. Covered
offline: `lib/channels/line/pipeline.test.ts` runs verify → `parseInbound` →
`ingestInbound` on real (pglite) Postgres, including a batched delivery and a
redelivery; `adapter.test.ts` mocks `fetch` for the push path.

---

## 2026-09-08 · M2 — Multi-channel inbox

**The inbox was already channel-agnostic; M2 made the channel *visible*, not
*actionable*.** `listConversations` never filtered by channel and `sendReply`
already routed outbound via `getAdapter(channel.type)`. The work was: join
`channel` into the two read queries so each conversation carries
`{ id, type, name }`, and render that as a label. No `channel.type` branch
exists in a page, a component, or a route — the label is `channel.name`
printed verbatim, `type` only rides along on a `data-channel` attribute for
future styling/tests.

**Channel label styling is deliberately uniform.** One `.chan` style for
every channel — no per-type colour (not even LINE green). Keying CSS on
specific `channel.type` values would mean the "channel-agnostic" UI needs an
edit for every new channel; brand-coloured tags can be a real feature later.
Backlog.

**`ChannelTag` lives in `app/inbox/`, imported by both pages.** A five-line
server component. Rejected: inlining it twice (drifts), or a `lib/` home (it
is JSX, and nothing outside the inbox renders it).

**Reply delivery failure now surfaces as 502.** `POST
/api/conversations/:id/messages` catches `OutboundDeliveryError` (the adapter
throwing because the platform rejected the push) and answers `502
delivery_failed`, alongside the existing 404/400. Before M2 no adapter could
fail this way — the website `sendOutbound` is a no-op. The row is not written
on a failed send (delivery is attempted first; an outbox is still backlog).

**`hookTimeout` raised to 30s** (`vitest.config.mts`). Each suite builds a
fresh pglite in `beforeEach`; with the LINE and M2 suites added, parallel
WASM init started tripping the default 10s hook timeout on a loaded machine.
Not a logic failure — the suite is green run serially. The deeper fix (a
shared fixture, or fewer workers) is backlog.

**Verified by build + tests, not by eye.** `queries.test.ts` asserts a
website and a LINE conversation come back in one list each tagged with its
channel; `reply.test.ts` asserts a LINE reply hits the push API with a
mocked `fetch` and a widget reply calls no API. A live look at the two-
channel inbox needs a seeded LINE conversation in the shared DB — folded
into the same LINE-OA checkpoint from M1.
