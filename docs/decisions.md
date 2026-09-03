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
