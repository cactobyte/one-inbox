# Day 3 — the website widget

A standalone embed that threads a visitor's messages into a conversation
and receives replies live, built without touching any other channel.

## Commits

1. `Fix: commit the AppDb type that day 2 depended on but never staged` —
   found while re-reading day 2 before starting: every day 2 commit that
   touched `db/index.ts` staged other files only, so `AppDb` (which
   `lib/inbox/*` and the test suite import) was never actually on `main`.
   CI has been red since day 2 pushed. Fixed and pushed first, no code
   change — just staging what should already have been there.
2. `Day 3: standalone website widget with SSE receive and reconnect` —
   everything below.

## The widget (`widget/src`, plain `tsc`, no bundler)

One embed tag:

```html
<script type="module" src="https://<host>/widget/index.js"
        data-channel-id="…" data-token="…"></script>
```

- `identity.ts` — visitor id in `localStorage`, storage-agnostic so it's
  testable without a DOM; falls back to an in-memory id if storage throws.
- `client.ts` — `sendMessage` POSTs to day 2's inbound endpoint;
  `connectStream` opens `EventSource` to the new stream endpoint.
- `ui.ts` — shadow-DOM bubble + panel, optimistic send, reconciles the SSE
  echo against the optimistic bubble by message id.
- `index.ts` — reads `data-channel-id`/`data-token` off the script tag
  (found by `querySelector`, not `document.currentScript` — module scripts
  don't set it), derives the API origin from the script's own `src`.

Compiled to `public/widget/*.js` by `npm run build:widget` (wired into
`predev`/`prebuild`), gitignored — generated, not committed.

## The stream (`app/api/channels/[channelId]/stream/route.ts`)

SSE, polling Postgres every 1.5s (no queue, no pub/sub — ruled out by
CLAUDE.md, and it's what "SSE" already meant per day 1's decision). Resume
is native `EventSource` behaviour: the browser remembers the last event
`id` and resends it as `Last-Event-ID` on reconnect; the server reads that
header and resumes from exactly there (`lib/inbox/{cursor,stream}.ts`,
keyset over `message (created_at, id)`, no new table). The stream ends
itself every 5 minutes so a Vercel function timeout looks like an ordinary
drop the client already knows how to recover from.

CORS (`lib/cors.ts`) was added to this endpoint and, minimally, to day 2's
inbound endpoint — both are gated by the channel's public token rather than
a cookie, so a wildcard origin is safe; `/api/conversations/*` stays
same-origin only.

## Two real bugs, found by actually using it

Both are in `docs/decisions.md` in full; the short version:

1. **Timestamp precision.** `message.created_at` defaulted to microsecond
   precision; the driver hands back millisecond-only `Date` objects. A
   cursor built from a row's own timestamp and round-tripped through `Date`
   compared as *less than* the row it came from, so the stream resent the
   newest message forever. Fixed with a migration (`timestamptz(3)`). 35
   pglite tests were green throughout — pglite didn't reproduce it.
2. **Missing `.js` extensions.** `tsc` doesn't rewrite extensionless
   relative imports for real ESM output; the compiled widget 503'd trying
   to load `./identity` and `./ui` in the browser. `tsc --noEmit` is silent
   about this either way.

Neither showed up until I loaded the actual widget in an actual browser tab
(`public/widget-demo.html`) and watched the network tab / console.

## What was tested

- `npm run typecheck`, `typecheck:widget`, `lint`, `next build` — clean.
- 35 Vitest tests (7 files): cursor round-trip and garbage handling,
  reconnect resumes with no dupes/drops including a same-timestamp
  tiebreak, visitor identity persists across a simulated reload and threads
  into the same conversation (alone, and combined with real `ingestInbound`).
- Manual curl against the running server + live Neon: send, dedupe,
  `Last-Event-ID` reconnect.
- Manual, real Chrome tab: loaded the widget, sent a message, watched it
  render optimistically then confirm via the SSE echo. No console errors.

## Check first

- `docs/decisions.md` Day 3 section — the visitor-identity mechanism and
  the "channel token is public once it's in a script tag" framing are the
  two genuine judgment calls; everything else follows from day 1/2.
- `docs/backlog.md` "Widget" section, especially the pglite/Neon precision
  gap — worth knowing about before trusting the test suite alone on
  something timing-sensitive again.

## Not built (correctly — later days)

Inbox UI, any other channel adapter, file upload, widget theming, agent
typing indicators.
