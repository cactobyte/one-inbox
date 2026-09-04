import { connectStream, sendMessage } from "./client.js";
import type { WidgetConfig, WidgetMessage, StreamMessageEvent } from "./types.js";

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, sans-serif; }
  .bubble {
    position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px;
    border-radius: 50%; background: #111; color: #fff; border: none;
    font-size: 24px; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.3);
    z-index: 2147483000;
  }
  .panel {
    position: fixed; right: 20px; bottom: 86px; width: 320px; height: 420px;
    background: #fff; border: 1px solid #ddd; border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,.2); display: flex; flex-direction: column;
    overflow: hidden; z-index: 2147483000;
  }
  .panel[hidden] { display: none; }
  .head {
    padding: 10px 12px; background: #111; color: #fff; font-size: 14px;
    display: flex; align-items: center; gap: 6px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6c6; }
  .dot.down { background: #c66; }
  .list { flex: 1; overflow-y: auto; padding: 10px; font-size: 13px; }
  .msg { margin-bottom: 8px; max-width: 85%; padding: 6px 9px; border-radius: 8px; white-space: pre-wrap; word-break: break-word; }
  .msg.inbound { background: #111; color: #fff; margin-left: auto; }
  .msg.outbound { background: #eee; color: #111; }
  .msg.pending { opacity: .55; }
  .row { display: flex; border-top: 1px solid #ddd; }
  textarea {
    flex: 1; border: none; padding: 8px; font-size: 13px; resize: none; height: 40px;
  }
  textarea:focus { outline: none; }
  button.send { border: none; background: #111; color: #fff; padding: 0 14px; cursor: pointer; }
`;

/** Mount the widget as a shadow-DOM host appended to <body>. */
export function mountWidget(config: WidgetConfig, visitorId: string): void {
  const host = document.createElement("div");
  host.id = "one-inbox-widget";
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLE;
  root.appendChild(style);

  const bubble = document.createElement("button");
  bubble.className = "bubble";
  bubble.textContent = "💬";
  bubble.setAttribute("aria-label", "Open chat");

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;

  const head = document.createElement("div");
  head.className = "head";
  const dot = document.createElement("span");
  dot.className = "dot down";
  const title = document.createElement("span");
  title.textContent = "Chat with us";
  head.append(dot, title);

  const list = document.createElement("div");
  list.className = "list";

  const row = document.createElement("div");
  row.className = "row";
  const textarea = document.createElement("textarea");
  textarea.placeholder = "Type a message…";
  const sendBtn = document.createElement("button");
  sendBtn.className = "send";
  sendBtn.textContent = "Send";
  row.append(textarea, sendBtn);

  panel.append(head, list, row);
  root.append(bubble, panel);

  bubble.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  const messages: WidgetMessage[] = [];

  function render(): void {
    list.replaceChildren();
    for (const m of messages) {
      const el = document.createElement("div");
      el.className = `msg ${m.direction}${m.pending ? " pending" : ""}`;
      el.textContent = m.body; // textContent, never innerHTML: body is untrusted.
      list.appendChild(el);
    }
    list.scrollTop = list.scrollHeight;
  }

  /** Add or, if a message with this id already exists, replace it in place. */
  function upsert(message: WidgetMessage): void {
    const i = messages.findIndex((m) => m.id === message.id);
    if (i >= 0) messages[i] = message;
    else messages.push(message);
    render();
  }

  async function handleSend(): Promise<void> {
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";

    const messageId = crypto.randomUUID();
    upsert({
      id: messageId,
      direction: "inbound",
      body: text,
      attachments: [],
      sentAt: new Date().toISOString(),
      pending: true,
    });

    const outcome = await sendMessage(config, { messageId, visitorId, text });
    if (!outcome.ok) {
      upsert({
        id: messageId,
        direction: "inbound",
        body: `${text} (failed to send — ${outcome.error})`,
        attachments: [],
        sentAt: new Date().toISOString(),
      });
      return;
    }
    // Success: leave it marked pending until the SSE stream echoes it back
    // and reconciliation (by id, in the stream handler below) clears the flag.
  }

  sendBtn.addEventListener("click", () => void handleSend());
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  });

  const stream = connectStream(config, visitorId);
  stream.addEventListener("open", () => {
    dot.classList.remove("down");
  });
  stream.addEventListener("error", () => {
    // EventSource retries on its own; this just reflects connection state.
    dot.classList.add("down");
  });
  stream.addEventListener("message", (event: MessageEvent<string>) => {
    const data = JSON.parse(event.data) as StreamMessageEvent;
    upsert({
      id: data.id,
      direction: data.direction,
      body: data.body,
      attachments: data.attachments,
      sentAt: data.sentAt,
    });
  });
}
