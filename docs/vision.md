# One Inbox — Full Vision

## What this becomes
A multi-tenant SaaS platform: a business signs up, connects its customer-facing
channels (LINE, Messenger, Instagram, WhatsApp, website chat, Shopee, Lazada,
TikTok Shop), invites its team, and every conversation across every channel
lands in one shared inbox. Later: lightweight CRM, broadcast messaging, AI-
assisted replies. Target market: Thailand SMEs (LINE > WhatsApp there).

## Current state (end of week 1)
Multi-tenant architecture and channel-abstraction proven end-to-end for ONE
channel (website), with a live agent inbox, real-time delivery (SSE), and
account-scoped data isolation enforced at the query layer. Auth, channels,
and accounts are currently seeded/wired by hand — no self-serve anything yet.

## Non-negotiable architecture (do not violate, ever)
- A channel adapter only normalizes inbound payloads into a Message and sends
  outbound Messages. Zero business logic in adapters.
- Nothing downstream of the core knows which channel a message came from.
  If you write `if (channel === 'x')` outside an adapter, the abstraction leaked.
- Every query scoped to account_id. No exceptions, ever, from day one.
- Internal API designed as if already public.
- Conversation state changes go into an append-only event table.
- Core tables: account, channel, contact, conversation, message, agent, event.
  Adding a table is a real decision — document it in docs/decisions.md, don't
  just add it.

## Known open flags (carry forward, revisit, don't silently resolve)
1. SSE on serverless has connection-duration limits — resume-from-last-event-id
   exists but transient-drop recovery is not yet verified end-to-end.
2. Signed-cookie sessions can't be revoked server-side.
3. agent.email is globally unique — blocks one person working across two accounts.
4. Prod and local currently share one Neon DB — no staging environment.

## Phases (in order — do not skip ahead)

### Phase 1 — Prove the architecture (mostly done)
One more channel (LINE — Thailand-priority) implemented against the existing
adapter interface with zero interface changes, or a documented reason why the
interface needed to change. Multi-channel agent inbox (conversations from
different channels in one list, replies routed via the correct adapter,
nothing UI-side knows which channel it's rendering). Hardening: the four open
flags above get actually resolved or explicitly deferred with a reason.
Exit criteria: two real channels working end-to-end, demoable to a real user
(Jesper), core flags no longer theoretical.

### Phase 2 — Make it a real multi-tenant product
Self-serve signup (email verification, password reset). Per-tenant channel
connection UI — a business owner enters their own LINE/Messenger credentials
without touching code or env vars; credentials stored encrypted, not in env
vars. Team management — invite teammates, roles/permissions per account.
This phase does NOT start until Phase 1's exit criteria are met AND there's
an actual decision (with Jesper) that this is being built.

### Phase 3 — Beyond the inbox
CRM (contact history, notes), broadcast messaging, AI-assisted replies,
billing/plans. Not scoped in any detail yet — deliberately. Don't let any
of this leak into Phase 1 or 2 work as "just one small thing while I'm here."

## How to plan sessions from here
At the end of each session, propose the next milestone (scope + what "done"
looks like + what will be tested) — in chat or a scratch note, not a
committed doc — and STOP, waiting for a go-ahead. Do not self-chain
multiple unapproved milestones in one sitting. Do not move to the next phase
without an explicit go-ahead, even if the current phase's work is finished
early. If you think scope should expand beyond what's currently approved,
say so and wait — don't just build it.