# Changelog

What shipped, newest first. One entry per milestone. The reasoning is in
`docs/decisions.md`; the detail is in git history.

---

## M5 (Sept 2026) — Password reset

- **`/forgot-password`** — enter email, always get "if that's an account, a
  link is on its way" (no enumeration). Emails a signed reset link, 1h TTL.
- **`/reset-password?token=…`** — new-password + confirm form. The action
  re-validates the token, writes the hash, drops every existing session
  (`bumpSessionEpoch`, M3), then signs the agent in fresh and → `/inbox`.
- **Single-use links** — the token is bound to the session epoch at issue;
  completing the reset bumps it, so the link can't be replayed.
- **"Forgot your password?"** link added to the sign-in page.
- **No migration, no new deps.** Reuses M4's email + stateless-token pattern.
  Extracted `lib/signed-token.ts` (three near-identical token modules now);
  consolidating `session.ts` / `verification.ts` onto it is backlog.
- Verified by running the whole flow against Neon (throwaway account, deleted).

---

## M4 (Sept 2026) — Self-serve signup

First Phase-2 milestone. Anyone can create a workspace; no more seed-only
agents.

- **`/signup`** — business name, your name, email, password (8+). Creates the
  `account` + owner `agent` (unverified) in one transaction, emails a
  confirmation link.
- **`/verify?token=…`** — a Route Handler: marks the email verified (idempotent),
  signs the agent in, redirects to the inbox. Bad/expired link →
  `/login?verify=invalid` with a resend prompt.
- **Login now requires a verified email** — refused (after the password check,
  so it can't probe accounts) with a resend option on the sign-in page.
- **Verification token** is stateless and signed like the session cookie
  (`lib/verification.ts`), 24h, no table. Both token types carry a `prp`
  claim now and reject each other.
- **Email** (`lib/email.ts`) — Resend via `fetch`, no SDK. Unconfigured
  (local/preview) → the message is logged, so the flow works without email
  infra; the link is in the server log.
- **Migration `0004`** — `agent.email_verified_at`, and backfills all existing
  agents to verified so the login check doesn't lock them out. Apply to Neon
  before/with this deploy.
- New env (all optional in dev): `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`.
- Verified by running the whole flow against Neon (throwaway tenant, then
  deleted). Caught + fixed a nested-`<form>` bug that broke the resend button.

---

## M3 (Sept 2026) — Hardening

Closed or consciously deferred the four Day-1 flags.

- **SSE transient-drop recovery — verified live.** Drove the "wifi blips
  mid-conversation" case against the real deployment: reconnect with
  `Last-Event-ID` delivers a message missed while disconnected exactly once,
  and repeats nothing. New `stream.test.ts` case for mid-burst resume.
- **Per-session revocation — shipped.** `agent.session_epoch` (migration
  `0003`), carried in the session cookie as `epc`; `getCurrentAgent` rejects
  a stale cookie. `bumpSessionEpoch()` = "sign this agent out everywhere"
  (M5's password reset will use it). No `session` table.
- **`agent.email` uniqueness — deferred to M6** (team management), where
  account membership gets designed. Global-unique keeps login unambiguous
  for now.
- **Staging DB — deferred with a runbook** (Neon branch + Vercel env). A
  console operation on the one shared asset; the code is already portable.
- **Migration `0003` must run against Neon before/with this deploy** —
  `getCurrentAgent` selects the new column.

---

## M2 (Sept 2026) — Multi-channel inbox

Website and LINE conversations in one list; replies routed to the right
adapter; the UI never learns which channel a conversation is on.

- **Channel surfaced in the read queries.** `listConversations` and
  `getOwnedConversation` join `channel` and return `{ id, type, name }` per
  conversation. Still no per-channel filter — every channel, one list.
- **Channel label in the UI** (`app/inbox/channel-tag.tsx`). Renders
  `channel.name`; `channel.type` only rides a `data-channel` attribute. One
  uniform style for every channel — no `channel.type` branch anywhere in the
  page/component/route layer.
- **Reply routing** was already channel-agnostic (`sendReply` →
  `getAdapter`). M2 adds a `502 delivery_failed` on the reply endpoint for
  when a platform rejects the push (`OutboundDeliveryError`).
- **Tests:** a website + a LINE conversation returned together, each tagged;
  a LINE reply hits the push API (mocked `fetch`), a widget reply calls no
  API. `vitest` `hookTimeout` raised to 30s for pglite init under load.

---

## M1 (Sept 2026) — LINE adapter

Second channel. LINE Messaging API webhooks in, agent replies out, through
the pipeline the website widget already used — no downstream changes.

- **LINE adapter** (`lib/channels/line/`). `parseInbound` turns one webhook
  body into every message it carries; `sendOutbound` delivers an agent reply
  with the push API. 1:1 user chats, text (media → a placeholder body).
- **Webhook verification keyed on channel type** (`lib/channels/verify.ts`).
  LINE's `x-line-signature` HMAC over the raw body; the shared-token check
  stays the default. `ChannelAdapter` stays at two methods.
- **Interface change:** `ChannelAdapter.parseInbound` now returns
  `InboundMessage[]` — LINE (and later Messenger) batch several messages per
  delivery. The inbound route loops the ingest and returns `results[]`.
- **No migration.** `channel.type` already allowed `line`; credentials live
  in `channel.config` (encryption is roadmap M7). Idempotency on LINE's
  `message.id` handles LINE's webhook redelivery unchanged.
- **Tested offline** (verify → parse → ingest on real pglite Postgres, push
  path with a mocked `fetch`). A live LINE OA round-trip is the open
  checkpoint.

---

## Week 1 (Sept 2026) — website widget MVP

Live on Vercel. One channel: website chat. (Deployment URL: see docs/demo.md
— the `one-inbox-xi` URL in older docs is stale, pending the real one.)

- **Foundations.** Next.js App Router, Drizzle + Neon Postgres, the
  seven-table schema (migration `0000`), agent email/password auth
  (`scrypt` + stateless signed-cookie sessions), GitHub Actions CI.
- **Channel adapters + message flow.** Two-method `ChannelAdapter` interface,
  the website adapter, the adapter registry, the normalised `Message` model.
  Idempotent inbound ingestion endpoint (one transaction) and the outbound
  reply path. pglite test harness. Migration `0001` (platform-identity
  columns).
- **Website widget.** Standalone `tsc`-built embed — one `<script>` tag,
  shadow DOM, visitor identity in `localStorage`. SSE receive with native
  `Last-Event-ID` resume. Migration `0002` (`timestamptz(3)` for the cursor).
- **Agent inbox.** Account-scoped query layer (`lib/inbox/queries.ts`),
  conversation list + thread view + reply form. An agent's reply reaches an
  open widget live.
- **Production / demo readiness.** Deployment made publicly reachable
  (Vercel deployment protection turned off), seed password de-hardcoded,
  live end-to-end and resilience testing, demo runbook (`docs/demo.md`).
