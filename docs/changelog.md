# Changelog

What shipped, newest first. One entry per milestone. The reasoning is in
`docs/decisions.md`; the detail is in git history.

---

## M11 (Sept 2026) — Contact/CRM basics

- **`/contacts/[id]`** — a contact profile: email/phone, a free-text notes
  field, and every conversation for that contact across every channel
  ("History across channels"), each linking back into the real conversation
  view. Reached from a conversation's header (contact name is now a link).
- **`contact.notes`** — one new nullable column (migration `0008`). No new
  table, no edit history kept.
- No new linking needed for cross-channel history: `contact` was already
  account-scoped rather than channel-scoped, so `lib/contacts.ts` just
  queries every `conversation` for a `contactId`, unfiltered by channel.
- Verified live in an actual browser against real Neon: seeded a throwaway
  account + a real inbound message, signed in, clicked through from the
  conversation to the contact profile, saved notes, reloaded cold and
  confirmed the notes persisted in Neon, confirmed a random contact id
  404s. Throwaway account deleted after.

---

## M10 (Sept 2026) — Onboarding flow

- **`/onboarding`** — a checklist for a brand-new account: connect a channel,
  invite a teammate. Both link to the real pages already built (M6, M7);
  this milestone is a status view, not new capability.
- **No new column, no eighth table.** Completeness is derived from data
  that already exists — any `channel` row, any non-owner `agent` row
  (`lib/onboarding.ts`) — the same flag-free style as `channel.disabledAt`.
- `/verify` (the link in the signup email) now lands a fresh owner on
  `/onboarding` instead of `/inbox` — that's the account's actual first
  login. Invited teammates (`/accept-invite`) still land on `/inbox`
  directly; the two onboarding steps are owner-only actions.
- Skippable at any time ("Skip for now"), and reachable again later from a
  "Get started" link in the inbox nav that only shows for an owner with an
  incomplete checklist.
- Verified live against real Neon: minted a real verification token for a
  throwaway account, confirmed `/verify` redirects to `/onboarding` with
  both steps "not done", inserted a real channel + a real pending teammate,
  confirmed the checklist flips to "done" and the inbox nav link
  disappears. Throwaway account deleted after.

---

## M9 (Sept 2026) — Billing scaffolding

- **`/settings/billing`** — current plan (free/pro) and subscription status;
  the owner gets "Upgrade to Pro" (Stripe Checkout) or, once subscribed,
  "Manage billing" (Stripe's hosted Customer Portal — cancel, update card,
  invoices, no custom UI needed).
- **`account.plan`** (`"free" | "pro"`) plus three Stripe id/status columns
  — no new table. `plan` defaults `"free"` for every account.
- **`/api/billing/webhook`** keeps `plan`/`subscription_status` in sync —
  signature-verified (hand-rolled, matching Stripe's own scheme, thoroughly
  tested), idempotent by construction (it always sets the latest state, so
  a Stripe retry is harmless).
- **No feature gating on `plan` anywhere** — this milestone is plumbing
  only, exactly as scoped; a real product decision for later.
- Created a placeholder test-mode Stripe Price so checkout had something to
  point at — swap for real pricing whenever that's decided.
- Verified against real Stripe's test-mode API and real Neon: a live
  checkout session, then hand-signed the three webhook events a real
  completed checkout produces and POSTed them to the real route — customer
  linked, plan flipped to pro, page updated, a bad signature 401s,
  cancellation reverted to free. Test data deleted after.
- **`STRIPE_WEBHOOK_SECRET` isn't real yet** — needs a webhook endpoint
  added in the Stripe dashboard pointing at the deployed URL, which then
  issues the real signing secret.

---

## M8 (Sept 2026) — Per-tenant channel management

- **`/settings/channels`** now shows, per channel: enabled/disabled, when it
  last received a verified webhook, and its most recent send failure (if
  any) — no dashboard, three nullable columns on `channel`.
- **Enable/disable**, owner-only. Disabled blocks the inbound webhook (403
  `channel_disabled`) and blocks agent replies through it (403); the
  widget's SSE stream is unaffected.
- **Reconnect** — owner-only form to replace a LINE channel's stored
  credentials without deleting/recreating it (keeps its conversation
  history). Separate action from enabling; reconnecting a disabled channel
  leaves it disabled.
- Outbound send failures (e.g. an expired LINE access token) are now
  recorded on the channel and cleared by the next successful send. Inbound
  *verification* failures deliberately do not set this — only a real send
  failure does, so the status doesn't cry wolf from webhook-URL noise.
- Migration `0006`: `disabled_at`, `last_inbound_at`, `last_error`,
  `last_error_at` — all nullable, no backfill, applied to Neon before push.
- Verified against the real app and real Neon over HTTP (browser
  unavailable this session, same curl-replay approach as M6/M7): connect →
  webhook succeeds and status updates → disable → same webhook now 403s →
  re-enable → works again → reconnect with new credentials → old secret
  401s, new secret 201s. Test data deleted after.

---

## M7 (Sept 2026) — Settings/integrations UI

- **`/settings/channels`** — every agent sees which channels are connected
  and when; the owner also gets "Connect a LINE Official Account" (name +
  channel secret + channel access token), which shows the webhook URL to
  paste into the LINE console once connected.
- **Credentials encrypted at rest** — a new nullable `channel
  .credentials_encrypted` column, AES-256-GCM (Node's built-in `crypto`, no
  new dependency). `channel.config` stays for genuinely public metadata
  (the widget's inbound token); secrets never touch it.
- **`lib/channels/config.ts#resolveChannelConfig`** merges the two back into
  the flat config object adapters already expect — zero changes to the LINE
  adapter or webhook verifier from M1.
- **`db/seed.ts`'s LINE-via-env-vars block is gone** — the whole point of
  M7 is not env vars or code. `docs/demo.md` now points at the UI.
- New env: `CHANNEL_CREDENTIALS_KEY` (32 bytes). Needed only once a channel
  with real credentials is connected; not required for the widget.
- Verified against the real app and real Neon, in a real browser this
  session: connected a LINE channel, confirmed the stored row is genuinely
  encrypted, then signed and POSTed a real LINE webhook to the printed
  webhook URL — `201 Created`, proving decrypt → verify → ingest end to
  end (a wrong signature still 401s). Test rows deleted after.
- **`CHANNEL_CREDENTIALS_KEY` is not yet set on Vercel** — connecting a
  channel on the live deployment will 500 until it is.

---

## M6 (Sept 2026) — Team management

- **`/team`** — every agent on the account, owner first; owners get an
  invite form (email + role) and, on pending rows, Resend / Cancel.
- **Invite by email** creates a pending `agent` row (unusable password
  hash, `email_verified_at` null) in the owner's account and emails a
  7-day signed link. `accept-invite` sets the invitee's real name and
  password, marks the email verified, signs them in, → `/inbox`.
- **`agent.email` stays globally unique** — the M3-deferred decision,
  resolved: one person, one agent, one account. Inviting an email that
  already has an agent row anywhere is rejected, with a clear message.
- **Cancel** deletes a still-pending invite (never an active teammate —
  enforced in the delete's `WHERE`, not a separate check) so a mistyped
  address doesn't permanently occupy that email.
- Only the owner may invite / cancel / resend, checked against the DB role.
- No migration — reuses `email_verified_at`, `session_epoch`, and the
  existing `owner`/`admin`/`agent` roles.
- Verified by replaying real form submissions (`curl` matching Next's
  server-action encoding) against `next dev` on Neon — the Chrome
  extension wasn't available this session. Full invite → accept → login →
  reuse-rejected → cancel → re-invite cycle, then the throwaway account
  deleted.

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
