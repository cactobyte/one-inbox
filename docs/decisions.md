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
