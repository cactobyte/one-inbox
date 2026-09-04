import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of a widget-supplied token against
 * `channel.config.inboundToken`. Shared by the inbound endpoint (day 2) and
 * the SSE stream endpoint (day 3) — both are gated the same way.
 */
export function tokenMatches(provided: string | null, expected: unknown): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
