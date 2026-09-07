# Changelog

What shipped, newest first. One entry per milestone. The reasoning is in
`docs/decisions.md`; the detail is in git history.

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
