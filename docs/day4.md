# Day 4 — agent inbox

A signed-in agent can see their account's conversations, open one, and
reply — and that reply reaches an open widget live, through the mechanism
day 3 already built.

## Commit

`Day 4: agent inbox — conversation list, thread view, live reply to widget`

## Query layer (`lib/inbox/queries.ts`)

Three functions, each taking `accountId` as a required argument and
filtering on it in the `WHERE` clause itself:

- `listConversations(db, accountId)` — most recently active first, with a
  last-message preview (a correlated subquery, not a denormalised column —
  see decisions.md).
- `getOwnedConversation(db, accountId, conversationId)` — throws
  `NotFoundError` if the id doesn't exist *or* belongs to another account.
  Both cases produce the exact same error; there's nothing to distinguish
  "wrong account" from "never existed" from the outside.
- `listMessages(db, accountId, conversationId)` — calls
  `getOwnedConversation` first, so a foreign id 404s before `message` is
  ever queried.

This is the same shape day 2's `ingestInbound`/`sendReply` already use —
every write or read that touches a conversation takes the account id as a
parameter and the query does the filtering. Nothing relies on a page or a
route handler to hide rows after fetching them.

Pagination reuses day 3's cursor codec (`lib/inbox/cursor.ts`) — same
`(timestamp, id)` keyset problem, opposite direction.

## Routes

- `GET /api/conversations` — paginated list, agent's account only.
- `GET /api/conversations/:id/messages` — paginated, added next to day 2's
  existing `POST` on the same file.
- `POST /api/conversations/:id/messages` — **unchanged**. The reply form
  below calls this exact endpoint; there is no second send path.

## UI

- `/inbox` — list, or the existing "No conversations yet" empty state.
- `/inbox/[conversationId]` — message history + a reply form. The form is a
  client component that `fetch()`s the day 2 POST endpoint and calls
  `router.refresh()`. Two plain server-rendered pages, not a split-pane
  client app — nothing in "basic UI only" asked for one.

No live updates on the agent side: a new inbound message needs a page
reload to show up. Task 10 only requires the *widget* receive a reply
live, which it does — the reply becomes a `message` row through the
unchanged `sendReply` → adapter path, and day 3's stream (polling that
table) picks it up on its next tick. Teaching the inbox UI to watch its own
stream is a real, separate addition — in backlog, not built here.

## A bug the day 3 tests didn't catch

The SSE stream was sending each message's *database row id* as its
identity. The widget's optimistic bubble for its own send is keyed by the
*client-generated* id it POSTed — a different UUID. Reconciliation
(matching the echo to the optimistic bubble) silently never matched for a
visitor's own messages, so after any reconnect they rendered twice. Found
by opening two real Chrome tabs — the agent inbox in one, the widget in the
other — replying, and watching the widget duplicate an *older* message,
not the new reply. Fixed by sending `platformMessageId ?? id`; a regression
test (`lib/inbox/stream.test.ts`) locks in that an inbound message keeps
its sender's id and an agent reply's is null.

## What was tested

- `npm run typecheck`, `typecheck:widget`, `lint`, `next build` — clean.
- 44 Vitest tests total (9 files). New this session: account isolation on
  every query — own account works; a *real* conversation id from another
  account 404s on list, read, and `sendReply`; a made-up id behaves
  identically. A reply written via `sendReply` shows up in
  `fetchMessagesSince` using the cursor the widget already had.
- Manual, two real Chrome tabs at once: signed in as the seeded agent,
  opened the conversation from day 3's widget testing, saw the full
  history, replied — watched the reply appear in the *other* tab's open
  widget with no refresh, in both directions (widget → inbox → widget).
  A guessed conversation id in the address bar renders Next.js's 404 page.
- One flaky test run under heavy concurrent load (dev server + curl +
  Chrome automation all hitting the same Neon connection); two clean
  re-runs after. Noted in backlog, not chased further.

## Check first

- `docs/decisions.md` Day 4 section.
- `lib/inbox/queries.ts` — this is the file enforcing rule 3 for reads;
  worth confirming the account-scoping pattern reads as obviously correct.
- `docs/backlog.md` "Agent inbox" section — no live updates and no
  mark-as-read are the two most visible gaps if you click around.

## Not built (correctly — out of scope this session)

Search, filters, assignment, any CRM feature, agent-side live updates,
"load older messages" UI (the endpoint paginates; the page doesn't use it
yet), any channel beyond website.

## Try it

```
npm run dev
npm run db:seed   # prints the seeded agent's login + a channel id/token
```

Log in at `/login`, open `/inbox`. Embed the widget from a second tab
(`/widget-demo.html?channelId=...&token=...`, both from the seed output) to
see a reply arrive live.
