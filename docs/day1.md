# Day 1 — what was built

Week one, one channel (website widget) — and the widget itself is day 2. This
day is the skeleton everything else hangs off.

## Commits (in order)

1. `Scaffold Next.js app` — create-next-app, App Router, `strict: true`,
   ESLint flat config. `/` redirects to `/inbox`.
2. `Normalise line endings` — `.gitattributes` forcing LF so lint behaves the
   same on Windows and the Linux CI runner.
3. `Wire up Drizzle + Neon Postgres and define the seven-table schema` —
   `db/index.ts` (lazy Neon HTTP client), `drizzle.config.ts`, `db/schema.ts`,
   `.env.example`.
4. `Generate initial migration` — `db/migrations/0000_init.sql`, checked in,
   **not applied** (no DATABASE_URL in this environment).
5. `Agent auth` — password hashing, signed-cookie sessions, login page,
   protected `/inbox` empty state, seed script, Vitest tests.
6. `Add GitHub Actions CI` — typecheck + lint + test on push/PR.
7. `Add docs/` — decisions, backlog, questions.

## The seven tables

`account`, `agent`, `channel`, `contact`, `conversation`, `message`, `event`
— defined in `db/schema.ts`, migration in `db/migrations/0000_init.sql`.

- Every table except `account` has `account_id NOT NULL REFERENCES account(id)`
  with `ON DELETE CASCADE`. No global rows.
- `message` has `UNIQUE(channel_id, platform_message_id)` — the anti-duplicate
  constraint. `platform_message_id` is nullable and Postgres treats NULLs as
  distinct, so outbound messages that don't have a platform id yet are fine.
- `event` is append-only (no `updated_at`, insert only).
- Indexes on `account_id` / `conversation_id` for the high-volume tables
  (`message`, `event`, `conversation`).
- `channel.type` / `event.type` / conversation status are `text` + a
  TypeScript union, not Postgres enums — see decisions.md.

## Auth

- `lib/password.ts` — `scrypt` (Node stdlib), stored as `salt:hash`.
- `lib/session.ts` — stateless HMAC-signed cookie `oi_session`, payload
  `{ sub: agentId, exp }`, keyed with `SESSION_SECRET`. **No session table**
  (would be an eighth). 7-day fixed expiry.
- `lib/auth.ts` — `getCurrentAgent()` / `requireAgent()`.
- `app/login/` — server action verifies the password (same error and roughly
  the same work whether or not the email exists), sets the cookie, redirects
  to `/inbox`. `useActionState` form.
- `app/inbox/page.tsx` — `requireAgent()` guard; renders "No conversations
  yet" and a sign-out button. Nothing more (inbox UI is day 2/3).

## What you should check first

1. **Read `docs/questions.md`.** Five decisions were made to keep moving —
   most important: sessions are a signed cookie with no table (seven-table
   limit), and the first agent is created by a seed script because no signup
   UI was in scope. If either is wrong, say so before day 2.
2. **Skim `db/migrations/0000_init.sql`** — this is the SQL that will run
   against production. Confirm the shape of the seven tables and the
   `message` unique constraint are what you expect.
3. `docs/decisions.md` — the WebSockets-vs-SSE call (chose **SSE**) is the
   one CLAUDE.md says not to revisit, so push back now if you disagree.
4. Run it locally: `npm run dev`, visit `/inbox` → should bounce to `/login`.

## What is NOT done (needs you — no remote / no database here)

- **Push.** This repo has no git remote. Create the GitHub repo and
  `git push -u origin main`.
- **CI green.** The workflow runs once pushed to GitHub. It was run locally:
  `npm run typecheck`, `npm run lint`, `npm test` (9 tests) all pass.
- **Deploy green.** Connect the repo to Vercel + a Neon database. `next build`
  was verified locally and passes.
- **Migrate + seed.** Once `DATABASE_URL` and `SESSION_SECRET` are set:
  `npm run db:migrate`, then
  `SEED_AGENT_EMAIL=you@example.com SEED_AGENT_PASSWORD=... npm run db:seed`.
- Set `DATABASE_URL` and `SESSION_SECRET` in Vercel project env vars.

## Not started (correctly — later days)

Chat widget, any channel adapter, inbox UI beyond the empty state, AI,
analytics dashboards. See `docs/backlog.md`.
