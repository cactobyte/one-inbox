# Open questions

Written down during a task when the answer wasn't obvious. Each one has a
"picked for now" so work could continue — change the answer here and open a
task if the default is wrong.

## Day 1

### Sessions vs the seven-table limit

"Agent auth: sessions" was asked for, but the data model is fixed at seven
tables and a `session` table would be an eighth.
**Picked for now:** stateless HMAC-signed cookie, no table. Revocation is
coarse (rotate `SESSION_SECRET`). If you want real per-session revocation,
that's an eighth table or a version column on `agent` — say which.

### How is the first agent created?

No signup UI was in scope, so nothing can create an agent through the app.
**Picked for now:** `db/seed.ts` (`npm run db:seed`), reads
`SEED_AGENT_EMAIL` / `SEED_AGENT_PASSWORD`. An invite flow is in the backlog.

### Neon driver: HTTP vs WebSocket/pooled

The app uses `drizzle-orm/neon-http` (one stateless request per query). Good
for the short queries auth needs; no transactions across statements.
**Picked for now:** HTTP. If day 2+ needs multi-statement transactions
(e.g. create conversation + first message + event atomically), switch to the
Neon serverless WebSocket pool or a `postgres`/`pg` connection.

### `email` uniqueness scope on `agent`

**Picked for now:** globally unique. See backlog for the multi-account case.

### Should `/` be a page?

**Picked for now:** `/` immediately redirects to `/inbox` (which then
redirects to `/login` if signed out). No marketing page in scope.
