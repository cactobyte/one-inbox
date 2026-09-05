# Day 5 — production / demo readiness

No new features. Day 5 made the existing website-channel flow demo-ready on
the live Vercel deployment and wrote the runbook for showing it.

The only code change all day is one string in `db/seed.ts` (the default
seeded password). Everything else is verification, configuration, and docs.

## Commits

1. `Day 5: change the seeded demo password off the known default` — the
   `changeme123` default was published in a public repo; changed before the
   deployment was made publicly reachable. Applied to the production Neon
   DB directly as well as the seed script.
2. `Day 5: production verification notes, demo runbook, backlog` —
   `docs/demo.md`, `docs/decisions.md`, `docs/backlog.md`.
3. `docs: day 5 summary` — this file.

## 1. Deploy verification

The live URL is **https://one-inbox-xi.vercel.app**.

- **The build was already green** (commit `d87e6b9`): widget compiled by
  `tsc` in `prebuild`, all routes present, TypeScript clean.
- **`DATABASE_URL` and `SESSION_SECRET` are set and work.** Verified by
  actually using production, not by reading config: agent login succeeds
  (the session cookie signs and verifies → `SESSION_SECRET`), and `/inbox`
  plus the inbound webhook both read and write the production Neon database
  (→ `DATABASE_URL`).
- **No production-specific breakage.** The session cookie is `Secure`
  (`NODE_ENV==="production"`) + `SameSite=Lax`, correct for the same-origin
  agent login. The Neon serverless `Pool` held up across the whole live
  smoke test. Nothing about pooling, cookies, or origins needed a fix.

### One thing that *was* broken for the demo — and fixed

**Vercel Authentication (deployment protection) was on** for every
`*.vercel.app` URL. That is a Vercel login wall in front of the entire app:
the audience can't open the URL, and — the real problem — every
cross-origin call from an embedded widget (`POST /inbound`, the SSE stream)
was rejected with `401` by the protection layer before reaching our code.

Turned it off (`ssoProtection: { enabled: false }`). This is a
configuration change, not a code change, and it's the correct one: a
website widget is worthless if the API is behind an SSO wall. It's also the
reason the seeded password had to change the same day. Written up in
`docs/decisions.md`.

## 2. Seed data check

Checked before touching anything. The production database already has a
usable demo account and **was not re-seeded**:

- 1 account ("Demo Co"), 1 agent (`owner@example.com`), 1 widget channel.
- 1 pre-existing conversation with a realistic exchange from day 3/4 testing
  ("Hi, do you ship to Chiang Mai?" → "Yes! …" → "Great, thank you!").
- Live smoke testing (step 5) added two more conversations. All three are
  real data in the shared database now; the demo runbook tells the
  presenter to work from the newest one.

## 3. Seeded password

`owner@example.com` was `changeme123` — a default visible in `db/seed.ts`
in a public repo, i.e. a published credential the moment the deployment is
public.

- Set to a fresh non-default value, applied **directly to the production
  Neon database** (the deploy shares that one database — there is no
  separate prod DB), verified by hashing it, writing it, reading it back,
  and confirming the new password verifies and the old one is rejected.
- `db/seed.ts` no longer has a hardcoded default at all — it now requires
  `SEED_AGENT_PASSWORD` and exits with an error if it's missing, the same
  way it already treats `DATABASE_URL`. Swapping one guessable string in
  public source for another isn't the fix; not having one is.
- The password itself is **not committed** — not in `docs/demo.md`, not
  anywhere in the repo. It's shared out of band. (A first pass did briefly
  put it in `docs/demo.md`; that commit's value was then rotated out and
  the file now carries only a placeholder. The rotated-out value sits in
  git history — harmless for a throwaway demo credential on an account with
  no real data, but noted here rather than hidden.)

## 4. Embed script

The real one-tag embed, pointed at the live deployment:

```html
<script
  type="module"
  src="https://one-inbox-xi.vercel.app/widget/index.js"
  data-channel-id="c80c9428-8fbe-4042-9f3c-782c889550ef"
  data-token="612d0f76f3d1ff4f40cc84da8b812b5f9c0114997a50efbe"
></script>
```

Verified working **dropped into a plain static HTML page served from a
different origin** (a local static server on `127.0.0.1`, not localhost-the-
app and not the Vercel domain). Cross-origin, against the live deployment:
the three widget module files load, the SSE stream connects, and messages
post — all with the production CORS headers (`Access-Control-Allow-Origin:
*` on the widget assets and the two widget-facing API endpoints). The
`apiBase` is correctly derived from the script's own absolute `src`.

The hosted `widget-demo.html` (same-origin, query-param driven) also works
and is the zero-setup option in the runbook.

## 5. End-to-end smoke test — on the live deployment, by hand

Two browser windows, customer on the left, agent on the right:

1. Widget on the external test page → sent "Hi! Do you have the Doi Chaang
   roast in stock?"
2. It appeared in the live inbox within ~2s, top of the list, unread badge.
3. Opened it as the agent, replied "Yes, the Doi Chaang medium roast is in
   stock — 250g and 1kg bags…"
4. **The reply appeared in the widget on the external page with no reload**
   of that tab. Confirmed the same both directions across several
   round-trips.
5. The visitor's own messages render exactly once — the day 3
   reconciliation fix holds in production.

No bugs surfaced. No code was changed for this step.

## 6. Resilience check — on the live deployment

- **Reload mid-conversation → same thread persists.** Fully reloaded the
  external host page, reopened the widget: same conversation, full history,
  no duplicates, reconnected (green status dot). Done twice. No new
  conversation row was created — the visitor id in `localStorage` threads
  back into the existing conversation.
- **SSE resume (`Last-Event-ID`) against production.** A fresh stream
  connection replays the conversation with a cursor `id:` on every event;
  reconnecting with `Last-Event-ID` set to the last cursor returns **zero**
  message events — no replay, no duplicates, no drops. This is the day 3
  mechanism, verified live.
- **Not verified:** a *transient* network blip triggering native
  `EventSource` auto-retry inside the page. The browser-automation tooling
  has no offline toggle, and `window.stop()` is a permanent close (the
  widget correctly shows its disconnected dot and does not retry — that's
  spec-correct behaviour for an abort, not a bug), so the "drop the
  connection for 5 seconds and watch the page recover on its own" path
  wasn't reproducible here. Both halves of the mechanism (native retry;
  server-side resume) are proven independently. Flagged in `docs/backlog.md`
  — worth a manual DevTools-offline pass before relying on it on venue wifi.

## Bugs found

None. Day 5 changed no application logic.

## Not done (out of scope, in `docs/backlog.md`)

- No separate staging environment — prod and local share one Neon database.
- Three scruffy test conversations on the demo account; left alone rather
  than editing production data unasked. The runbook starts a fresh one.
- Automated transient-drop reconnect test (see step 6).
- History rewrite for the rotated-out password in commit `2c86e30` — not
  worth it for a data-free demo account.

## Check first

- `docs/demo.md` — the runbook. URLs and the embed snippet are live values.
  The password is deliberately not in it; it's shared out of band.
- `docs/decisions.md` day 5 section — the deployment-protection call and why
  it's the right one.
