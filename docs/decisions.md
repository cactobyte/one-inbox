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
