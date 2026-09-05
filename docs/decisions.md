# Decisions

One or two lines per entry: what was chosen, what was rejected, why. Append
only; do not rewrite history.

---

## 2026-09-03 — Day 1 foundations

### Database: Postgres (Neon)

Chosen. The data model is relational with hard integrity requirements —
`account_id` scoping on every row, foreign keys between conversation /
message / event, and a uniqueness constraint that stops duplicate webhook
deliveries. Postgres enforces all of that in the database rather than in app
code. Neon specifically because it is serverless (scales to zero, matches the
Vercel deploy) and branchable (a database branch per preview deploy later).
Rejected: a document store (would push referential integrity and the
dedupe constraint into application code) and SQLite (no serverless story,
weak concurrent-writer story for a shared team inbox).

### ORM / migrations: Drizzle

Chosen. TypeScript-first schema that produces real inferred row types, and
SQL-first migrations that are generated as plain `.sql` files and checked
into the repo (`db/migrations`), so what runs against production is
reviewable in a PR. Rejected: Prisma (extra engine binary, migration files
are less transparent) and hand-written SQL with no type link to the app
(the model changes every month as channels are added — the types must track
it automatically).

### Real-time transport: Server-Sent Events, not WebSockets

Chosen: SSE. Inbox real-time traffic is almost entirely server → client
(new inbound message, assignment changed, conversation resolved by a
teammate, tag added). The rare client → server events (send a reply, claim a
conversation) already go through normal POST / server actions and do not
need a socket. SSE is plain HTTP: it passes through corporate proxies and
load balancers untouched, the browser `EventSource` reconnects on its own,
and it works within Vercel's streaming-response model. WebSockets on Vercel
need a separate always-on service to hold the connections, which breaks the
"one Next.js app and one Postgres database" rule for week one. Trade-off
accepted: HTTP/1.1 caps a browser at ~6 concurrent connections per origin;
Vercel serves over HTTP/2 where that limit does not apply. Per CLAUDE.md
this is not to be revisited.

### Sessions: signed cookie, no session table

The seven-table data model has no `session` table and adding an eighth
needs sign-off. Agent sessions are therefore a stateless HMAC-signed cookie
(`{ agentId, exp }` signed with `SESSION_SECRET`). Rejected: adding a
`session` table (out of scope for day 1). Trade-off: revocation is coarse —
rotating `SESSION_SECRET` invalidates every session at once. Per-session
revocation is in `backlog.md`.

### Password hashing: Node `scrypt`

Chosen: the standard-library `crypto.scrypt`. It is a memory-hard KDF, needs
no native build (bcrypt) and no new dependency. Rejected: `bcryptjs` (extra
dep), `argon2` (native build, painful on Windows dev + Vercel).

### Channel / status columns: text + TypeScript union, not Postgres enum

`channel.type`, `event.type` and the conversation status are `text` columns
with a narrowing TypeScript union type. A new channel ships roughly monthly;
widening a real Postgres enum is a migration every time, a plain text column
is not. Integrity that matters (foreign keys, the dedupe constraint) is
still enforced in the database.

---

## 2026-09-03 — Day 2: channel adapters and message flow

### Adapter interface: exactly two operations, no channel identity in the model

`ChannelAdapter` is `parseInbound(payload, config)` and
`sendOutbound(message, config)` — nothing else. The normalised
`InboundMessage` / `OutboundMessage` name no channel; the person and the
thread are opaque platform-id strings the core stores but never interprets.
Signature verification, retry, echo-filtering are deliberately *not* on the
interface. Rejected: putting a `verify()` / `handleWebhook()` method on the
adapter — it would make "exactly two things" false and leak transport
concerns into every future adapter.

### Platform identity lives on `contact` / `conversation`, not a mapping table

To find-or-create the contact and conversation for an inbound message we need
to map (platform person, platform thread) → rows. The clean design is a
join table (contact ↔ channel with a source id); that would be an eighth
table. Instead: `contact.platform_contact_id` (unique per account) and
`conversation.platform_thread_id` (unique per channel), both nullable.
Trade-off: a contact is currently tied to whichever account first saw that
platform id; cross-channel identity and merge are unsolved (backlog).

### DB driver: switched to the Neon WebSocket pool

`neon-http` has no interactive transactions. The inbound path must write
contact + conversation + message + event atomically, so `db/index.ts` now
uses `drizzle-orm/neon-serverless` with a `Pool`. Day 1's questions.md
anticipated this. Lazy creation and build-without-DATABASE_URL are kept.

### Idempotency: unique index first, race caught second

Dedupe is `UNIQUE(channel_id, platform_message_id)` from day 1. `ingestInbound`
checks for the existing message inside the transaction and returns
`status: "duplicate"`; if two identical webhooks race, the loser's `INSERT`
hits the constraint, the transaction rolls back, and the caller re-reads the
committed row and still returns `duplicate`. No new message, no new event.

### Website adapter: one visitor is one thread; `sendOutbound` is a real no-op

v1 maps `thread.platformId = visitorId` — the widget doesn't track threads.
`sendOutbound` calls no API: the widget has no inbound endpoint, it *pulls*
outbound messages through the real-time layer (day 3+). It acknowledges with
a null platform message id. This is the actual behaviour of a pull channel,
not a stub. Multi-thread support is in the backlog.

### Inbound webhook auth: shared per-channel token, for now

The endpoint checks `x-channel-token` against `channel.config.inboundToken`
(constant-time). Real platforms sign webhooks differently (LINE: HMAC-SHA256
of the body; Messenger: `X-Hub-Signature-256`). That per-platform
verification will need a home when LINE lands — likely a third adapter
capability or an endpoint-level strategy keyed on channel type. Noted in
backlog; not built now.

### Tests: pglite, not mocks

`@electric-sql/pglite` (dev dependency, approved) gives an in-process real
Postgres. The dedupe unique index and every `account_id` filter run for
real in CI. Rejected: a fake in-memory repository (would not prove Postgres
enforces anything) and hitting Neon from CI (needs secrets, flaky).

---

## 2026-09-04 — Day 3: the website widget

### Visitor identity: a random id in `localStorage`, scoped to the host page's origin

Real decision, not silent: on first load the widget mints a UUID
(`crypto.randomUUID()`) and stores it in `localStorage` under
`oneinbox:visitor:<channelId>`, on whatever origin the widget is embedded
on (the *customer's* site — the widget is not in an iframe, so it shares
that page's storage, not ours). Reused on reload, so `platform_thread_id`
(day 2) keeps mapping to the same conversation. Rejected:
- **A cross-site cookie set by our API.** Would need `SameSite=None; Secure`
  and survive third-party-cookie blocking (Safari ITP already blocks this;
  Chrome is heading there) — actively hostile to a widget embedded on
  someone else's domain.
- **Asking the server to mint an id on first load.** Extra round trip before
  the widget can even show a UI, for no benefit — the id is a thread key,
  not a credential; the client can generate a fine one.
- **Fingerprinting.** Unnecessary and worse for privacy for a problem
  `localStorage` already solves.

Trade-off accepted: private browsing / storage-blocking extensions mean
`localStorage` can throw or silently not persist. `widget/src/identity.ts`
wraps access (`safeStorage`) and falls back to an in-memory id for that
page load only — the widget still works, it just won't thread across a
reload in that case. No visitor-merge story if the same person clears
storage and starts a new id — same limitation `contact` merging already
has (day 2 decisions), noted again in backlog.

### The channel token is public, not a secret, once it ships to a browser

Day 2's `x-channel-token` is embedded directly in the widget's
`data-token` attribute — anyone can read it from page source or dev tools.
It was never meant to be confidential; its job is "which channel is this,
roughly" (like a Stripe *publishable* key), not authorisation of a trusted
party. No code changed for this — it's a naming of what was already true,
so nobody reaches for it as a real secret later.

### CORS added to the two widget-facing endpoints only

The widget runs on an arbitrary customer origin and calls our API
cross-origin — without CORS headers the browser blocks it outright, so
this isn't optional for "embeddable via a single script tag" to actually
work. Added `lib/cors.ts` (wildcard origin, since neither endpoint uses
cookies — the channel token is the only credential) and applied it to
the day 2 inbound POST (`OPTIONS` handler + headers on every response,
CLAUDE.md's "directly blocks the current task" exception to no
day-2-refactors) and the new SSE stream GET. Deliberately **not** applied
to `/api/conversations/*` — those are cookie-authenticated and same-origin
only; permissive CORS there would be a real hole, not a convenience.

### SSE resume: `Last-Event-ID` is native; the server just has to honour it

`EventSource` already remembers the last event `id` it saw and resends it
as a `Last-Event-ID` header on every reconnect — no client-side reconnect
loop was written. The server (`app/api/channels/[channelId]/stream/route.ts`)
polls Postgres (no queue, no pub/sub — CLAUDE.md rules those out, and this
is what "SSE" already meant per day 1) every 1.5s for messages after a
cursor, and ends the stream cleanly every 5 minutes so a Vercel function
timeout looks like an ordinary drop the client already knows how to
recover from, not a special case. The cursor is `(message.created_at,
message.id)` (`lib/inbox/cursor.ts`) — existing columns, no new table.

Found by testing against real Postgres, not the pglite suite: `created_at`
defaults to microsecond precision, but the driver hands back a JS `Date`
(millisecond-only), so a cursor built from a row's own timestamp and
round-tripped through `Date` compared as *less than* the row it came
from — the stream resent the last message forever. Fixed by storing
`message.created_at` at `timestamptz(3)` (migration `0002`), so the value
Postgres stores and the value a `Date` round-trip produces are identical.
pglite didn't reproduce this — see backlog for what that means for trusting
it on timing-sensitive logic.

### Widget shell: one script tag, `type="module"`, config read from `data-*`

The embed is `<script type="module" src=".../widget/index.js"
data-channel-id="…" data-token="…"></script>`. Module scripts don't set
`document.currentScript` (a real, easy-to-miss browser gotcha), so config is
read via `document.querySelector('script[data-channel-id][data-token]')`
instead of relying on it; the API origin is derived from that same script's
own resolved `src`, so the bundle is not hard-coded to one deployment.
Source is compiled by plain `tsc` (`widget/tsconfig.json`, ES module
output, no bundler — no new dependency) to `public/widget/*.js`, generated
at build time (`predev`/`prebuild` run `build:widget`) and gitignored, not
committed. TypeScript does not rewrite extensionless relative imports for
real ESM output, so `widget/src/*.ts` imports its siblings with an explicit
`.js` (e.g. `from "./ui.js"`) even though the source file is `.ts` — found
the same way as the cursor bug, by actually loading the built output in a
browser (Chrome dev tools showed 503s resolving `./identity`, `./ui`) —
`tsc --noEmit` type-checks fine either way since it resolves against the
`.ts` file, so this class of bug is invisible to typecheck and only shows
up at runtime.

### Message identity bug: the widget echo used the wrong id

Found by the same real-browser test as above, one layer deeper: the stream
sent each message's `id` as the database row id, but the widget's
optimistic bubble for its own send is keyed by the *client-generated*
`messageId` (day 2's `platformMessageId`) — a different UUID. So the
"reconciliation" this file already describes below silently never matched
for a visitor's own messages: the DB id never equals the client id, so
`upsert` always appended instead of replacing, and every visitor message
that survived a reconnect rendered twice. Fixed by having the stream send
`platformMessageId ?? id` as the message identity — an agent reply has no
`platformMessageId` (nothing client-generated exists for it), which is
exactly the case where falling back to the row id is correct: the widget
never had a pending copy of an agent's message to reconcile against. Added
a test (`lib/inbox/stream.test.ts`) asserting the stream exposes
`platformMessageId` distinctly per direction, so this can't silently regress
the way it silently shipped the first time — a Vitest suite with no browser
in the loop had no way to catch a bug that only exists in what two
different parts of the system call "the same message's id".

### Message reconciliation: optimistic send + SSE echo, deduped by id

The widget renders its own message immediately with the client-generated
id it's about to POST (day 2's `messageId` = `platformMessageId`). When
that same message arrives back over SSE — which it always does, since the
stream is *all* messages on the conversation, not just agent replies — the
widget matches by id and replaces the pending bubble in place rather than
appending a second one. Chosen over only trusting the POST response,
because the SSE stream is the single source of truth either way (task 4
needs it for agent replies); reusing it for the visitor's own echo avoids
a second, different "is this confirmed" code path.

---

## 2026-09-05 — Day 4: agent inbox

### Account scoping lives in the query functions, not the pages or the UI

`lib/inbox/queries.ts` (`listConversations`, `getOwnedConversation`,
`listMessages`) all take `accountId` as a required argument and put it in
the `WHERE` clause themselves — the same shape day 2's `ingestInbound` and
`sendReply` already use. A conversation id from another account is not
filtered out of a bigger result or hidden by the page; the query never
returns it, and `getOwnedConversation` throws `NotFoundError` rather than
returning `null` so a foreign id and a made-up id are indistinguishable to
the caller. Every route handler and every page is a thin caller of these —
there is exactly one place that decides whose rows these are.

### List + detail are two pages, not a split-pane app

`/inbox` (list) and `/inbox/[conversationId]` (thread + reply) are separate
server-rendered routes with an ordinary link between them, not a client-side
split view sharing state. Slower to click through, far less code, and nothing
in "basic UI only — list + conversation pane" asked for a single-page app.
Reconsider if agents complain about the round trip.

### No live updates on the agent side (yet)

The widget gets SSE (day 3); the inbox list and conversation view do not —
opening `/inbox` or a conversation is an ordinary page load, and a reply
lands via `router.refresh()` after the POST resolves, not a stream. Task 10
only requires the reply reach the *widget* live; teaching the agent UI to
watch its own stream is a straightforward but real addition (a second
`EventSource` consumer, a session-authenticated variant of the day 3 route)
that wasn't asked for here. In backlog.

### Reply form calls the day 2 endpoint over HTTP, not a new server action

`ReplyForm` (client component) `fetch()`s `POST
/api/conversations/:id/messages` — the exact endpoint day 2 built and day 3
already exercises no differently than the widget does. Rejected: a server
action calling `sendReply` directly. It would be one function call shorter,
but it's a second entry point into the same behaviour with its own request
lifecycle, and "do not build a new send path" reads most safely as "call the
one that already exists," not "call the function underneath it again from
somewhere new."

### Pagination cursor reuses day 3's codec, not a new one

`listConversations` and `listMessages` are keyset-paginated on the same
`(timestamp, id)` shape day 3's SSE resume uses, importing `encodeCursor` /
`decodeCursor` from `lib/inbox/cursor.ts` (day 3) — same problem, same
answer, going the other direction (newest-first, `<` instead of `>`). No
change to `cursor.ts` itself was needed.

### Last-message preview: a correlated subquery, not a denormalised column

`listConversations`'s preview text comes from a scalar subquery
(`select body from message where conversation_id = ... order by created_at
desc limit 1`) per row, not a `last_message_body` column kept in sync on
every write. It costs one index-backed lookup per row on a page of ~30
conversations — trivial at this scale — and there is nothing to keep
consistent by hand. Revisit only if the list query shows up as slow.

---

## 2026-09-06 — Day 5: production / demo readiness

Day 5 changed no application code (only the seed script's default password
string). Everything below is about the live Vercel deployment.

### Vercel Authentication (deployment protection) was on — turned off

The project shipped with Vercel's "Standard Protection" (SSO / Vercel
Authentication) enabled for every `*.vercel.app` URL. That put a Vercel
login wall in front of the whole app: a non-technical audience opening the
URL couldn't get in, and — worse for an embeddable widget — every
cross-origin call from a customer page (`POST /inbound`, the SSE stream)
came back `401` from the protection layer before it ever reached our code.
Turned off (`ssoProtection: { enabled: false }`). The app is now publicly
reachable, which is the whole point of a website widget. This is also why
the seeded password had to change the same day (below) — with the wall up,
a guessable login was academic; without it, it's a real exposure. If a
non-public staging URL is wanted later, the right move is a Vercel preview
deployment with protection left on, not protection on production.

### Seeded demo password: no hardcoded default, value not committed

`db/seed.ts` created `owner@example.com` with `changeme123` — fine when the
only reader was localhost, not fine once the deployment is public and the
seed script is in a public repo. The fix isn't to pick a different literal
(that's still a published credential): `db/seed.ts` now *requires*
`SEED_AGENT_PASSWORD` and exits if it's unset, the same way it already
treats `DATABASE_URL`. A fresh non-default value was set directly on the
production Neon database (the running deploy shares that one database —
there is no separate prod DB to migrate or seed) and is shared out of band,
not written into any tracked file — `docs/demo.md` carries a placeholder.
(A first pass did commit the value to `docs/demo.md`; it was rotated out
immediately, but the superseded value remains in git history — acceptable
for a throwaway credential on a data-free account, noted in the backlog.)
Proper auth hardening (rotation, rate limiting, lockout) stays in the
backlog; this was just removing a published credential.

### Production env / DB config: verified, nothing to change

`DATABASE_URL` and `SESSION_SECRET` are set on Vercel and work: login
against production succeeds (session cookie signs and verifies →
`SESSION_SECRET` good), `/inbox` and the inbound webhook both read/write
the production Neon database (→ `DATABASE_URL` good). The Neon serverless
`Pool` held up across many requests during the live smoke test — no
connection-exhaustion symptoms at this volume. The session cookie is
`Secure` in production (`NODE_ENV === "production"`) and `SameSite=Lax`,
which is correct for the same-origin agent login; no cookie-domain or
cross-site cookie config was needed because the widget deliberately doesn't
use cookies (day 3).

### SSE reconnect on the live deployment: resume verified server-side

The day 3 mechanism is (a) native `EventSource` auto-reconnect on a dropped
connection, (b) the server honouring the `Last-Event-ID` header to resume
from exactly where the client left off. Against the live deployment: a
fresh stream connection replays the conversation and every event carries an
`id:` cursor; reconnecting with `Last-Event-ID` set to the last cursor
returns **zero** message events — no replay, no duplicates, no drops. A
full widget reload mid-conversation (the harder path: brand-new connection,
full history replayed once, deduped by id) also comes back clean with the
thread intact. The one thing not exercised end-to-end is a *transient*
network blip triggering native `EventSource` retry in the page — the
browser-automation tools have no offline toggle, and `window.stop()` is a
permanent close (readyState `CLOSED`, no retry — the widget correctly shows
its "disconnected" dot), not a recoverable error. Both halves of the
mechanism are verified independently; the automated "pull the cable" is not.
