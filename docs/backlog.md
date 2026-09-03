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

## Product (later days, listed so they are not lost)

- Website chat widget (day 2/3).
- Channel adapters: LINE first (Thailand), then Messenger, Instagram,
  WhatsApp, Shopee, Lazada.
- Inbox UI beyond the empty state.
- `event`-table-driven analytics and workflow automation.
