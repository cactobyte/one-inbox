# Live demo runbook

How to run the One Inbox demo for a non-technical audience, on the live
Vercel deployment. Follow it top to bottom.

> **⚠️ The deployment URL below (`one-inbox-xi.vercel.app`) is stale.** Boris
> has the real one — replace every occurrence before using this runbook.

Everything here runs against production. There is no reset button — messages
you send during the demo stay in the inbox.

---

## What you're showing

A customer sends a message from a chat widget on a website. It lands in a
shared team inbox. An agent replies from the inbox, and the reply appears in
the customer's chat **instantly, without them reloading the page**. One
channel today (website chat); the same inbox is built to take LINE,
Messenger, WhatsApp and the rest without changing anything the agent sees.

---

## Before the room arrives (5 minutes)

1. **Two browser windows, side by side.** Left = the customer. Right = the
   agent. Put them literally next to each other so the audience sees both at
   once.

2. **Right window — sign in as the agent:**
   - Go to **https://one-inbox-xi.vercel.app/login**
   - Email: `owner@example.com`
   - Password: **not written here on purpose** — this file is in a public
     repo. Get it from whoever set up the deployment (it was last set on
     day 5). If you have database access you can reset it with
     `SEED_AGENT_PASSWORD=... npm run db:seed`.
   - You land on the inbox. Leave it here.

3. **Left window — open the customer's website with the chat widget:**
   - Go to
     **https://one-inbox-xi.vercel.app/widget-demo.html?channelId=c80c9428-8fbe-4042-9f3c-782c889550ef&token=612d0f76f3d1ff4f40cc84da8b812b5f9c0114997a50efbe**
   - A round chat bubble appears in the bottom-right corner. Don't open it
     yet.

4. **Sanity check:** click the bubble, send yourself a test message, confirm
   it shows up in the right window's inbox within a second or two, then
   close both. You're ready. (That test message will be in the inbox during
   the demo — either ignore it or use a fresh browser profile so the widget
   starts empty.)

> **Tip for a clean start:** the widget remembers the visitor between
> reloads (that's a feature — step 5 below). To demo as a brand-new
> customer, open the left window in a private/incognito window, or clear
> site data for `one-inbox-xi.vercel.app` first.

---

## Running the demo

### 1. "Here's a customer on a website."

Left window. Point at the page, point at the chat bubble.
*"This is a shop's website. Bottom right — that's our chat widget. It's one
line of code on their site."*

Click the bubble. The chat panel opens.

### 2. "They ask a question."

Type into the widget, e.g.:

> Hi! Do you have the Doi Chaang roast in stock?

Send it. It appears in the chat straight away.

### 3. "It lands in the team's inbox."

Switch to the right window. The conversation is at the top of the list, with
the customer's message and an unread marker.
*"Every channel the business has connected lands in this one list. The team
works through it together."*

Click the conversation. The full thread opens.

### 4. "An agent replies — from here, once."

Type a reply in the inbox, e.g.:

> Yes, the Doi Chaang medium roast is in stock — 250g and 1kg bags. Want me
> to reserve one?

Send it.

### 5. "The customer sees it immediately."

Switch to the left window. **Do not touch it — don't reload.** The agent's
reply is already there in the chat.
*"No refresh. The widget holds a live connection. If their wifi drops, it
reconnects and catches up on whatever it missed."*

### 6. (Optional) "And it survives a reload."

Reload the left window. Open the chat bubble again. The whole conversation is
still there — same thread, same history.
*"The widget recognises the returning visitor, so the conversation picks up
where it left off."*

### 7. (Optional) "This is the point of the architecture."

Back to the right window, the inbox list.
*"Nothing in this inbox knows the message came from a website widget. When we
add LINE next month, it shows up in this same list, the same way. The agent
never learns a second tool."*

---

## The embed snippet

This is the actual code a customer puts on their site — one `<script>` tag,
nothing else, works on any page:

```html
<script
  type="module"
  src="https://one-inbox-xi.vercel.app/widget/index.js"
  data-channel-id="c80c9428-8fbe-4042-9f3c-782c889550ef"
  data-token="612d0f76f3d1ff4f40cc84da8b812b5f9c0114997a50efbe"
></script>
```

- `data-channel-id` / `data-token` identify which inbox to post into. The
  token is **not a secret** — it ships in the page source by design (see
  `docs/decisions.md`, day 3). It only says "which channel"; it can't read
  anything.
- The widget renders in a shadow DOM, so the host page's CSS can't touch it
  and vice versa.
- Verified working dropped into a plain static HTML page served from a
  different origin (not localhost, not the Vercel domain) — it loads from
  and connects to the live deployment cross-origin.

If you want to demo from a *real* separate page instead of the hosted
`widget-demo.html`, save this as `index.html` anywhere and open it:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Example Shop</title></head>
  <body>
    <h1>Example Shop</h1>
    <p>Questions? Use the chat bubble.</p>
    <script
      type="module"
      src="https://one-inbox-xi.vercel.app/widget/index.js"
      data-channel-id="c80c9428-8fbe-4042-9f3c-782c889550ef"
      data-token="612d0f76f3d1ff4f40cc84da8b812b5f9c0114997a50efbe"
    ></script>
  </body>
</html>
```

---

## Facts you may be asked

| Question | Answer |
| --- | --- |
| URL of the app | `https://one-inbox-xi.vercel.app` |
| Agent login | `owner@example.com` — password held separately (not in this repo) |
| How does the customer's chat update live? | A Server-Sent Events connection (plain HTTP streaming). It reconnects on its own if dropped and resumes from the last message it saw. |
| Is there a mobile app / more channels / assignment / search? | Not yet. Week one is the website widget and a shared inbox. The data model and inbox are built so channels and team features slot in without a rewrite. |
| Where's the data? | One Postgres database (Neon), one Next.js app on Vercel. Nothing else. |

---

## Connecting a LINE channel (M1, technical prep)

Not part of the demo script above — this is the one-time setup to get a real
LINE Official Account flowing into the inbox.

1. In the [LINE Developers console](https://developers.line.biz/), open the
   Messaging API channel and note its **Channel secret** and a long-lived
   **Channel access token**.
2. Create the channel row (needs database access):

   ```
   SEED_AGENT_EMAIL=owner@example.com SEED_AGENT_PASSWORD=... \
   SEED_LINE_CHANNEL_SECRET=<channel secret> \
   SEED_LINE_CHANNEL_ACCESS_TOKEN=<access token> \
   npm run db:seed
   ```

   It prints the new channel id. Re-running with the same env updates the
   stored credentials.
3. In the LINE console, set the **Webhook URL** to
   `https://<deployment>/api/channels/<channel id>/inbound` and turn
   **Use webhook** on. "Verify" should return success.
4. Message the OA from a personal LINE account — it appears in the inbox as a
   new conversation. An agent reply goes back to LINE as a push message.

Limits in M1: 1:1 chats only, text only (a sticker or image shows as
`[sticker]` / `[image]`), and the contact shows as "LINE user" until the
profile lookup lands. See `docs/decisions.md` (M1) and `docs/backlog.md`.

---

## If something breaks mid-demo

- **Widget bubble doesn't appear:** hard-reload the left window
  (Ctrl/Cmd-Shift-R). If still nothing, the deployment or its database is
  down — check https://one-inbox-xi.vercel.app/login loads.
- **Reply doesn't show in the widget:** give it ~2 seconds. If it still
  doesn't, reload the left window — the conversation (including the reply)
  will load from history. Narrate it as "and it catches up on reconnect,"
  which is true.
- **Can't log in:** the password may have been rotated since this doc was
  written. Check with whoever set it up.
- **The inbox list is cluttered with old test messages:** that's real prior
  demo/test data in the shared database. Click into the newest conversation
  (top of the list) and work from there.
