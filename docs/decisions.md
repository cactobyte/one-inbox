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

---

## 2026-09-08 · M5 — Password reset

**Reuses M4's parts — no new infrastructure.** `/forgot-password` emails a
signed link; `/reset-password?token=…` shows a new-password form; the action
re-validates the token, writes the hash, and `bumpSessionEpoch`s (M3). Same
`lib/email.ts`, same stateless-token pattern, no table, no migration.

**The reset link is single-use, enforced through the session epoch.** The
token's subject is `<agentId>.<epoch-at-issue>`. Completing a reset bumps the
epoch, so a second click — or a link that was already used and then
intercepted — fails the epoch check in `resetPassword`. Rejected: a
`used_at` column (a table-ish write for something the epoch already tracks);
accepting reuse within the 1h window (a used reset link is a credential).

**A reset signs the agent in (fresh cookie at the new epoch) and drops every
other session.** They just proved mailbox control and chose the password;
making them type it again immediately is friction. Everyone else holding an
old-epoch cookie is logged out — which is the point of resetting after a
password leak. TTL is 1 hour (vs. 24h for signup confirmation): more
sensitive, acted on immediately.

**Reset works regardless of email-verification state** and does not change
it. An agent who signed up, never confirmed, and forgot their password can
still reset it; they still can't *log in* until they verify (M4). Kept
separate on purpose — one link proves one thing.

**Third signed-token module → extracted `lib/signed-token.ts`.** `session.ts`
and `verification.ts` each rolled their own HMAC token; M5 made three.
`signed-token.ts` is the shared `(purpose, subject, ttl)` primitive; M5 uses
it. Folding `session.ts` (its payload also carries `epc`) and
`verification.ts` onto it is in the backlog — not done here to keep M3/M4
auth code untouched.

**Verified by running it** (`next dev`, throwaway account, then deleted):
forgot → "if that's an account…" → the emailed link opens the form → mismatch
is caught → a real reset saves the new password and lands on the inbox → the
spent link then reports "already used" → the old password is refused, the new
one is accepted.

---

## 2026-09-08 · M4 — Self-serve signup

**Account is created up front (unverified), not held in the token.** Signup
inserts the `account` + owner `agent` immediately with
`email_verified_at = NULL`; the emailed link flips it. Rejected: deferring
the insert until verification and carrying the signup data in the token — a
fat token, the password hash in a URL, and no natural home for "resend".
Trade-off: accounts that are never verified accumulate; a sweep is backlog.

**Login is refused until the email is verified**, and only *after* the
password check passes — so the "confirm your email" message can't be used to
probe which addresses have accounts. The sign-in page then offers a resend,
which always reports success (`findUnverifiedAgent` returns null for unknown
*or* already-verified, same response either way).

**Verification link — a stateless signed token, same as the session
cookie.** `lib/verification.ts`: `base64url({sub, prp:"email_verify", exp}).sig`
HMAC'd with `SESSION_SECRET`, 24h. No table (the data model is full). Both
token types now carry a `prp` claim and each reader rejects the other's
purpose — a verification link can't be pasted in as a session cookie, and a
session cookie isn't a valid link. Legacy pre-M4 cookies (no `prp`) still
validate.

**`/verify` is a Route Handler, not a page.** It sets the session cookie and
redirects — a Server Component render can't write cookies. A bad/expired
token lands on `/login?verify=invalid` with a resend prompt.

**Email — Resend over `fetch`, no SDK** (`lib/email.ts`), the same
REST-not-dependency choice as the LINE adapter; swap providers by rewriting
that one file. When `RESEND_API_KEY` / `EMAIL_FROM` are unset (local, preview)
the message is logged, not sent — the whole flow still works end to end, the
link just appears in the server log. Rejected: the `resend` npm package (a
dependency for one POST); nodemailer + SMTP (more config, worse deliverability).

**Migration `0004`** adds `agent.email_verified_at` (nullable) **and
backfills every existing agent to `now()`** — agents that predate signup were
created by the seed script or a trusted insert; without the backfill the new
login check locks them (incl. the demo `owner@example.com`) out. Must be
applied to Neon before/with this deploy.

**Password rule: 8-character minimum**, in `parseSignup`. The rest of the
day-1 auth-hardening backlog (rate limiting, lockout, complexity) is still
open — M4 only needed signup not to accept a one-character password.

**`agent.email` stays globally unique.** Signup's duplicate check and the
"email already registered" message assume it. This is the M3 deferral (per-
account email is an M6 call); noting it here because M4 now depends on it.

**Verified by running the full flow** (`next dev` against Neon, a throwaway
tenant, then deleted): signup → "check your email" → the link verifies +
signs in + lands on an empty isolated inbox; a bad token → `/login?verify=
invalid`; login refused while unverified (generic "incorrect" on a wrong
password, no leak); resend works; a legacy pre-M3 session cookie still
validated.

> **Lesson — nested forms.** The resend control was a `<form>` rendered
> *inside* the login `<form>`. HTML forbids form nesting, so the browser
> drops the inner one and its button submits the *outer* form — every
> "resend" click re-ran `login`, not `resendVerification`. Only showed up
> clicking it in a real browser; typecheck and the unit suite were green.
> Fixed by making the resend form a sibling. `checkLogin` (lib/login.ts) was
> also extracted from the action so the three sign-in outcomes get tests.

---

## 2026-09-08 · M3 — Hardening

The milestone was "close or consciously defer the four Day-1 flags." Two
resolved, two deferred with a reason.

**Flag 1 — SSE transient-drop recovery: RESOLVED (verified live).** Ran the
"wifi blips mid-conversation" scenario against the real Vercel deployment
over HTTP: connect and catch up → drop → a new inbound message arrives while
disconnected → reconnect sending `Last-Event-ID` → the missed message is
delivered exactly once, and a further reconnect delivers nothing. No drop, no
dupe. Also added `stream.test.ts` coverage that resume works from the `id:`
of *any* event the route emitted, not just the last (the mid-burst case).
Not exercised: the OS/browser socket itself dropping (vs. an explicit
`fetch` abort) — that path is native `EventSource` + WHATWG-spec
`Last-Event-ID` resend, and the server half is now proven both in the suite
and live. Removed from the backlog.

**Flag 2 — per-session revocation: RESOLVED.** New `agent.session_epoch`
integer (migration `0003`, `DEFAULT 0 NOT NULL` — additive, existing rows and
existing cookies both read as 0). The session cookie payload gains `epc`;
`getCurrentAgent` rejects the cookie if `epc` ≠ the agent row's
`session_epoch`. `bumpSessionEpoch(db, agentId)` advances it — that is
"sign out this agent everywhere", and M5's password reset will call it.
Still no `session` table (a global logout is still "rotate SESSION_SECRET").
Rejected: a `session` table (the eighth table); a Redis denylist (new infra).

**Flag 3 — `agent.email` global uniqueness: DEFERRED to M6.** Today
`unique(email)` means email → one agent → one account, so login is an
unambiguous lookup. Moving to `unique(account_id, email)` to let one person
work two businesses' inboxes forces an account-selection step into the login
flow that nothing else needs yet, and it is a Phase-2 product call. M6 (team
management / invite) is where account membership actually gets designed;
decide it there. No code change now.

**Flag 4 — staging DB separated from prod: DEFERRED (infra, runbook
written).** Nothing in the code blocks it — `drizzle.config.ts` and the app
both take any `DATABASE_URL`. The move is a console operation on the one
asset a blind change could damage, so it is the owner's to run:
  1. In Neon, create a branch `production` off `main` (or a second project).
  2. Point the Vercel **Production** environment's `DATABASE_URL` at that
     branch's connection string; leave Preview/Development on `main`.
  3. Enable Neon's Vercel integration for per-preview branches if wanted.
  4. Run `npm run db:migrate` against the new production branch once.
Until then, local dev and prod still share one Neon database (backlog).

**Migration `0003` must be applied to the shared Neon DB before/with this
deploy** — `getCurrentAgent` now selects `session_epoch`, so the column has
to exist. `npm run db:migrate` against `DATABASE_URL`. (There is still no
migrate step in CI or the build — backlog.)

---

## 2026-09-13 · M6 — Team management

**`agent.email` stays globally unique — the M3 deferral is resolved, not
redesigned.** One person is one agent in one account, same as day one. An
invite to an email that already has an agent row *anywhere* — active or
still-pending, in this account or another — is rejected with "that email
already has a One Inbox account." Real multi-account membership
(`unique(account_id, email)` + an account picker at login) would be a bigger
identity change than "basic roles" called for; it needs an eighth table (a
membership row) or a materially different login flow, either way needs
sign-off. Rejected here as overreach for this milestone; the limitation is
explicit and testable rather than silently designed around.

**An invite is a pending `agent` row, not a new table.** `email_verified_at
IS NULL` doubles as "not yet accepted" — it already meant "hasn't proven
control of this email" for self-serve signups (M4), and accepting an invite
*is* proving that, so the same column does both jobs with one honest
meaning. The row gets an unguessable random password hash
(`hashPassword(randomBytes(32))`) so it cannot be logged into before
acceptance; `name` starts as the email until the invitee sets their own.

**Invite links use `lib/signed-token.ts` (M5), no epoch binding.**
Single-use here doesn't need the epoch trick M5's reset link used — accepting
an invite flips `email_verified_at` itself, which is the marker.
`acceptInvite` checks `IS NULL` inside the same transaction as the update, so
two racing accepts of one link can't both succeed. TTL is 7 days — invites
sit in inboxes longer than a password reset.

**Cancelling a pending invite is in the WHERE clause, not a second check.**
Day one: wrote `cancelInvite`'s delete with only an "isn't the owner" guard,
then caught in review — before running anything — that it would happily
delete an *active* teammate too, contradicting its own doc comment. Fixed by
putting `email_verified_at IS NULL` directly in the `DELETE ... WHERE`, which
is also race-safe against a concurrent accept (Postgres re-evaluates the
predicate against the current row). "Remove an active teammate" is a real,
separate feature (reassigning their conversations) — not built.

**Cancel exists specifically so a mistyped invite email isn't stuck
forever.** Because the email is globally unique, an invite nobody can accept
would otherwise permanently occupy that address. Verified live: cancelling
frees the email immediately for a fresh invite.

**Only the owner may invite, cancel, or resend — checked server-side against
the DB role, not the UI.** `admin` can be invited to but not yet grant
invites; letting admins invite too is backlog. The non-owner rejection path
(`inviteTeammate` throwing before any write) has its own test; the UI simply
never renders the controls for a non-owner, but the server never trusts that.

**No migration.** Everything M6 needs — `email_verified_at`, `session_epoch`,
`role` with `admin`/`agent`/`owner` — already existed. `checkLogin`/
`acceptInvite`/`registerAccount` compose without any schema change.

**Verified by running the real thing, without a browser.** The Chrome
extension wasn't connected this session. Instead: read the exact hidden
`$ACTION_*` / `$ACTION_ID_*` fields Next.js's server-action progressive-
enhancement encoding puts in each rendered form (the same mechanism that
makes `logout`'s plain `<form action={logout}>` work), and replayed real
multipart POSTs with `curl` against `next dev` on real Neon — invite → the
real email logged → `/team` shows "invited" with working Resend/Cancel →
accept sets password and signs in → `/inbox` loads → re-using the same
accept link fails → logging in with the new password through the *actual*
`/login` form succeeds → a non-owner's `/team` has no invite form → the
cancelled email is re-invitable. All test rows deleted after. This is a
heavier substitute for the browser tool, not a routine one — reach for it
again only if the browser is genuinely unavailable.

---

## 2026-09-14 · M7 — Settings/integrations UI

**Secrets get one new nullable column (`channel.credentials_encrypted`), not
a schema split.** `channel.config` stays exactly what it always was — public,
non-secret metadata an adapter needs (the widget's inbound token is a
publishable identifier, not a credential — day 3). Anything actually secret
(LINE's channel secret + access token) goes in the new column as one
AES-256-GCM envelope. `lib/channels/config.ts#resolveChannelConfig` merges
the two back into the flat object adapters/verify already expect, so
**zero changes to `lib/channels/line/adapter.ts` or `verify.ts`** — M1's code
is untouched. Rejected: encrypting the whole `config` blob (would touch every
adapter's config-reading code, including the widget's, for no benefit — the
widget has nothing secret to protect).

**Encryption — AES-256-GCM via Node's built-in `crypto`, no dependency.**
Same choice as `scrypt` for passwords, `createHmac` for tokens. GCM is
authenticated: a tampered or corrupted envelope fails to decrypt instead of
silently returning garbage (`CredentialsDecryptionError`). One env var,
`CHANNEL_CREDENTIALS_KEY` (32 bytes, hex or base64) — checked lazily, only
when a channel with encrypted credentials is actually touched, so the app
doesn't require it just to boot (same pattern as `SESSION_SECRET`). Rotating
it makes every previously-connected channel's credentials undecryptable —
same trade-off `SESSION_SECRET` rotation already has for sessions.

**`db/seed.ts`'s LINE block is deleted, not updated.** It used to write a
LINE channel's plaintext `channelSecret`/`channelAccessToken` straight into
`config` from env vars — exactly the pattern M7 exists to retire ("not env
vars or code"). Keeping it working under the new encrypted-column scheme
would mean two code paths writing LINE credentials (seed script and
Settings UI); deleting it means one. `docs/demo.md`'s LINE setup walkthrough
now points at `/settings/channels` instead of `SEED_LINE_CHANNEL_SECRET`.

**Whole-page owner gate for the connect form, not a route redirect.** Same
shape as `/team` (M6): any agent can view `/settings/channels` (which
channels exist, when connected — never credentials), but
`ConnectLineForm` only renders for the owner, and `connectLineChannel`
re-checks the role against the DB regardless — the UI omission is not the
security boundary. Consistent with M6 rather than inventing a second gating
style for one page.

**No "edit" or "disconnect" yet.** Connecting is the whole of M7; showing
connection status and letting the owner disable/reconnect a channel is M8
("per-tenant channel management") by roadmap design — building it now would
be the same milestone-jumping CLAUDE.md already rules out for adapters.

**Verified against the real, running app and the real database, browser
this time.** Connected a LINE channel through the actual `/settings/channels`
form; confirmed in Neon that `credentials_encrypted` is opaque ciphertext
containing neither typed-in secret anywhere in the row; then **signed a real
LINE webhook body with the same channel secret and POSTed it to the printed
webhook URL** — `201 Created`, a conversation and message created — proving
the decrypt → HMAC-verify → ingest chain is correct against production
Postgres, not just a mocked test. A wrong signature on the same channel
still 401s. A non-owner teammate (created through the real M6 invite flow)
sees the channel list but no connect form. All test rows deleted after.

> **Lesson — the key has to actually be set.** First live attempt 500'd:
> `CredentialsKeyError: CHANNEL_CREDENTIALS_KEY is not set` — correct,
> fail-closed behaviour; the key genuinely wasn't in local `.env` yet (it's
> new in M7, unlike `SESSION_SECRET` which every prior milestone already
> needed). Generated one, added it to the *local* `.env` (gitignored, never
> committed), restarted `next dev`, retried — worked. **Vercel's production
> environment still needs the same variable added** before a real owner can
> connect a LINE channel on the live deployment; it is not set there yet.

---

## 2026-09-15 · M8 — Per-tenant channel management

**Three facts, three nullable columns — no status table, no event log.**
`disabledAt` (owner paused it), `lastInboundAt` (a webhook verified and was
processed), `lastError`/`lastErrorAt` (the most recent *outbound* delivery
failure). Same style as `agent.email_verified_at` — a null/non-null
timestamp answering exactly one question — rather than a `status` enum or a
per-channel event stream. CLAUDE.md already rules out an analytics
dashboard; this is the minimum that makes "see connection status" true.

**`lastError` only ever comes from a failed *send*, never a failed inbound
verification.** A bad/unsigned request to the webhook URL (a scanner probing
it, a fat-fingered LINE console "Verify" retry) is not evidence the
channel's credentials are broken — only a push actually failing is. Setting
`lastError` on every failed verification would make the status display cry
wolf from internet noise. `lastInboundAt`, by contrast, only moves forward
on a *verified* request, so it stays a meaningful "still receiving" signal.

**Disabling blocks inbound and outbound; it does not touch the SSE
stream.** A disabled channel's webhook 403s (`channel_disabled`) before any
processing, and `sendReply` refuses to call the adapter
(`ChannelDisabledError` → 403 at the route). The widget's *stream* endpoint
(reading already-ingested history) is left alone — disabling is "pause new
activity on this integration," not "cut off a visitor mid-page-load" for a
read-only endpoint that was never the direction being paused.

**Reconnect and re-enable are two separate actions, not one.** Replacing a
LINE channel's credentials (`reconnectLineChannel`) does not touch
`disabledAt`. An owner might want to fix credentials while deliberately
keeping a channel paused a bit longer, or might disable a channel for a
reason unrelated to credentials (rate limiting a noisy integration, say).
Verified live: reconnecting with new credentials leaves a disabled channel
disabled.

**No new table for "connection status," and no delete for a channel.**
Deleting a connected channel — with real conversations hanging off it via
`channel_id` — is a materially different, riskier operation (what happens to
the history?) than anything M8 asked for. Not built; noted in backlog.

**Verified against the real app, real Neon, real HTTP** (browser still
unavailable this session — same curl-replays-the-server-action approach as
M6/M7). Connected a LINE channel, sent a real signed webhook → `201` and
`last_inbound_at` set → confirmed on `/settings/channels` ("last received
… ago"). Disabled it → the *same* signed webhook now `403`s
(`channel_disabled`). Re-enabled → webhook works again. Used the Reconnect
form to replace the channel's credentials → the *old* secret's signature now
`401`s, the *new* secret's `201`s. Test account deleted after.

**Migration `0006`** (four nullable columns) applied to Neon before this was
pushed — no backfill needed, existing rows read as enabled/no-history/no-error.

---

## 2026-09-16 · M9 — Billing scaffolding

**Plan lives on `account`, not a `plan`/`subscription` table.** Four columns
— `plan`, `stripe_customer_id`, `stripe_subscription_id`,
`subscription_status` — same reasoning as every prior milestone's status
fields: one account, one active subscription, nothing here needs its own
rows. `plan` is a plain `"free" | "pro"` union (not a Postgres enum), same
as `ChannelType` — a second tier is a product decision away, not a
migration away.

**Stripe over `fetch`, no `stripe` npm dependency.** Same call as LINE
(M1) and Resend (M4): the REST API is plain form-encoded HTTP, an SDK buys
convenience methods this app doesn't need yet. `lib/stripe.ts` is the one
place that knows the request shapes; `lib/billing.ts` never touches the
network directly.

**The webhook is the only writer of plan/status; checkout only links the
customer.** `checkout.session.completed` sets `stripe_customer_id` (via
`client_reference_id`, Stripe's own recommended way to correlate a session
back to our row without needing a customer to exist first) but does *not*
set `plan` — payment isn't confirmed at that point, a `customer.subscription
.*` event is. Reusing one handler for `created`/`updated`/`deleted` (they
carry the same shape) keeps this to one function instead of three near-
duplicates; `deleted` is just an update whose status happens to be
"canceled".

**Only `active`/`trialing` grant "pro"; everything else — `past_due`,
`unpaid`, `canceled`, `incomplete*` — reads as "free".** A placeholder
policy: nothing in the app gates a feature on `plan` yet (that's a real
product decision, explicitly out of scope for M9 per the roadmap), so this
has zero functional effect today. It only decides what the status chip
says. Revisit when a feature actually needs to check it — e.g. a grace
period for `past_due` might be the right call then and isn't now.

**No feature gating, anywhere, on purpose.** The roadmap is explicit
("does not need real pricing decided yet — just the plumbing") and CLAUDE.md
rules out inventing scope. `/settings/billing` shows the plan and lets the
owner start/manage a subscription; nothing else in the app reads
`account.plan`.

**Webhook signature verification — Stripe's own `t=...,v1=...` scheme,
hand-rolled.** HMAC-SHA256 over `${timestamp}.${rawBody}`, a 5-minute replay
tolerance (Stripe's own documented default), and every `v1` in the header
checked (Stripe sends more than one during a signing-secret rotation).
Thoroughly unit tested — this is money-adjacent, exactly what CLAUDE.md's
testing rule calls out.

**Verified against real Stripe and real Neon over HTTP** (browser
unavailable again — same curl-replay approach as M6–M8, plus this time
actually calling Stripe's live test-mode API, not just mine). Created a
placeholder test-mode Price (`price_1UGEBrIUMKnEHi7P54NkAjn6`, "One Inbox
Pro (TEST placeholder)", $29/mo — a stand-in so checkout had something real
to point at; swap it for real pricing whenever that's decided, nothing
depends on this exact price surviving). "Upgrade to Pro" → a real
`checkout.stripe.com` URL. Hand-signed and POSTed the three webhook events a
real completed checkout produces (`checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.deleted`) — customer
linked, plan flipped to "pro" with the right status, page updated to
"Manage billing", a wrong signature `401`s, cancellation dropped the account
back to "free". Test account deleted after.

**`STRIPE_WEBHOOK_SECRET` is not yet a real one.** The local `.env` value
used for the live test above is self-signed for that test only, not issued
by Stripe — a real one only exists once a webhook endpoint pointing at
`/api/billing/webhook` is added in the Stripe dashboard, which needs the
deployed URL (same chicken-and-egg as every prior milestone's webhook
setup). Still open — see docs/backlog.md.

**Migration `0007`** (four nullable columns, `plan` defaults `'free'`)
applied to Neon before this was pushed.
