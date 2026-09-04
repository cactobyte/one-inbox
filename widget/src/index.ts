import { getOrCreateVisitorId, safeStorage } from "./identity.js";
import { mountWidget } from "./ui.js";
import type { WidgetConfig } from "./types.js";

/**
 * Embed:
 *   <script type="module" src="https://<host>/widget/index.js"
 *           data-channel-id="…" data-token="…"></script>
 *
 * Module scripts don't set `document.currentScript`, so config is read off
 * whichever `<script data-channel-id>` tag is on the page (see
 * docs/decisions.md) rather than relying on it. `data-token` is the same
 * public per-channel token the day 2 inbound endpoint already expects —
 * it ships inside this file's own network requests, so it is not a secret,
 * only an identifier of which channel to post into.
 */
function readConfig(): WidgetConfig | null {
  const script = document.querySelector<HTMLScriptElement>(
    "script[data-channel-id][data-token]",
  );
  if (!script) return null;

  const channelId = script.dataset.channelId;
  const token = script.dataset.token;
  if (!channelId || !token) return null;

  return { channelId, token, apiBase: new URL(script.src).origin };
}

function boot(): void {
  const config = readConfig();
  if (!config) {
    console.error("[one-inbox widget] missing data-channel-id / data-token");
    return;
  }
  const visitorId = getOrCreateVisitorId(safeStorage(), config.channelId);
  mountWidget(config, visitorId);
}

if (document.body) {
  boot();
} else {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
}
