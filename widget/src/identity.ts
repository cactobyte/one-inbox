/**
 * Visitor identity: a random id, persisted client-side, reused across
 * reloads so a visitor's messages keep threading into the same
 * conversation (the server maps `platform_thread_id = visitorId`, one
 * thread per visitor — see docs/decisions.md).
 *
 * Storage is injected (not `window.localStorage` directly) so this is
 * testable without a DOM. Production passes `window.localStorage`, wrapped
 * so a throwing/unavailable store (Safari private mode, a sandboxed
 * embed) degrades to a fresh in-memory id for that page load rather than
 * crashing the widget — see `safeStorage` below.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(channelId: string): string {
  return `oneinbox:visitor:${channelId}`;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers without crypto.randomUUID. Not
  // cryptographically strong; fine for an opaque thread key, not a secret.
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Read the persisted visitor id for this channel, or mint and persist one.
 * Calling this again against the same storage (e.g. after a page reload)
 * returns the same id.
 */
export function getOrCreateVisitorId(
  storage: StorageLike,
  channelId: string,
): string {
  const key = storageKey(channelId);
  const existing = storage.getItem(key);
  if (existing) return existing;

  const id = randomId();
  storage.setItem(key, id);
  return id;
}

/**
 * Wrap `window.localStorage` so a widget on a page with storage blocked
 * (private browsing, cookie/storage-blocking extensions) doesn't throw. The
 * visitor id still works for the current page load; it just won't survive a
 * reload. That trade-off is documented in docs/decisions.md.
 */
export function safeStorage(): StorageLike {
  let memory: string | null = null;
  try {
    const probeKey = "oneinbox:probe";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return {
      getItem: () => memory,
      setItem: (_key, value) => {
        memory = value;
      },
    };
  }
}
