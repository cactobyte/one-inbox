# One Inbox

An omnichannel customer messaging platform for teams. Every message a
business receives — from any channel — lands in one shared inbox that a team
works through together.

Built for the Thai market first, where LINE matters more than WhatsApp.

---

## What it does today

This is week one. One channel is live: **website chat**. The pieces below
are built and working on the live deployment.

### Website chat widget

- **Embeds with a single `<script>` tag** on any website. No build step for
  the customer, no framework.
- Renders in an isolated shadow DOM, so the host page's styling can't break
  the widget and the widget can't leak into the host page.
- A visitor can **open the widget, send a message, and see it appear
  immediately** (before the server has confirmed it).
- **Replies from the team arrive live**, with no page refresh, over a
  streaming connection.
- The connection **recovers on its own** if it drops — when it reconnects it
  resumes exactly where it left off, with no missed messages and no
  duplicates.
- A returning visitor is **recognised across page reloads and revisits**, so
  the conversation continues in the same thread rather than starting over.

### Shared team inbox

- **Agents sign in** with an email and password.
- The inbox shows **every conversation for that team**, most recently active
  first, with a preview of the last message and an unread indicator.
- Opening a conversation shows its **full message history**.
- An agent can **type a reply**, and it reaches the customer's open widget
  live through the same streaming mechanism.
- A team only ever sees its own conversations. This isolation is enforced in
  the database queries themselves, not just hidden in the interface — an
  agent from one company cannot reach another company's conversation even by
  guessing its address.

### Under the hood (behaviour, not architecture)

- **One shared message format.** Every message is normalised to the same
  shape — who it's from, direction, body, attachments, timestamps —
  regardless of where it came from. Nothing in the inbox, and nothing built
  on top of it later, needs to know or care which channel a message
  originated on.
- **No duplicate messages.** Messaging platforms routinely deliver the same
  webhook more than once; the platform recognises a message it has already
  seen and ignores the repeat.
- **Everything that happens to a conversation is logged.** Created,
  message received, replied, and similar events are recorded to an
  append-only history. Nothing reads this yet — it exists so that analytics
  and automation can be built on a complete record rather than starting from
  the day they're switched on.
- **Multi-tenant from day one.** Every business is a separate account and
  every piece of data belongs to one. There is no shared or global state to
  untangle later.
- **The internal API is designed as if it were already public** —
  consistent resource names, real HTTP status codes, pagination on every
  list. Customers will eventually read and write their own data through it.

---

## What it's meant to become

The product adds roughly one new channel a month. Everything above was built
so that the following slot in without a rewrite.

### More channels

The next year of work, in order of priority for the Thai market:

- **LINE** (first)
- Facebook Messenger
- Instagram
- WhatsApp
- Shopee
- Lazada
- TikTok

Each one is just an adapter that translates that platform's messages to and
from the shared format. The inbox, and everything else, stays the same.

### A real team inbox

- **Assignment** — claim a conversation, assign it to a teammate, see who's
  handling what.
- **Filters, search, and saved views** over the conversation list.
- **Tags and status workflows** — open, pending, resolved, reopened.
- **Live updates on the agent side** — new customer messages appear in the
  inbox without a refresh, the way replies already appear in the widget.
- **Mark-as-read**, unread counts that clear when you'd expect them to.
- **Team management** — invite agents by email, and roles (owner / admin /
  agent) that actually govern what each person can do.

### A customer record (CRM)

- **Contact profiles** — one view of a person: their details, every
  conversation with them, across every channel.
- **Contact merge** — when the same human turns up on LINE and on the
  website, combine them into one contact and one history.
- **Notes** and internal context on a contact or conversation.

### Automation and analytics

- **A workflow automation engine** that reacts to conversation events —
  auto-replies, routing rules, escalations, office-hours behaviour.
- **Analytics** — response times, volume by channel, resolution rates, agent
  workload — built on the event history that's already being recorded.

### Later

- **AI assistance** — reply suggestions, summarisation, drafting — added once
  several channels exist and there's enough real traffic for it to be
  useful.
- **Broadcast / outbound campaigns** — sending to many contacts at once,
  within each platform's rules.
- **A brandable, themeable widget** — customer colours and copy, file and
  image uploads, typing indicators, read receipts.
- **Multiple threads per visitor** — a customer can start a new, separate
  conversation instead of one endless thread.

---

## Current status

| Area | State |
| --- | --- |
| Website chat widget | Live |
| Shared team inbox (list, thread, reply) | Live |
| Agent login | Live |
| Live delivery both directions | Live |
| Every other channel | Not started — designed for, not built |
| Assignment, filters, search, tags | Not started |
| CRM, automation, analytics, AI | Not started |

The live deployment is a demo of the website-chat flow end to end. See
`docs/demo.md` for how to run it.
