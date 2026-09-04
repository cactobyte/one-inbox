/**
 * CORS for the two endpoints a widget calls from an arbitrary customer
 * origin: the inbound POST and the SSE stream GET. Both are gated by the
 * channel's own public token, not a cookie, so a wildcard origin is safe —
 * see docs/decisions.md ("the inbound token is public once it ships to a
 * browser"). Every other route (the agent-authenticated `/api/conversations`
 * routes) is same-origin only and must NOT use this — permissive CORS on a
 * cookie-authenticated endpoint would be a real hole.
 */
const PUBLIC_CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-channel-token",
};

/** Answer a CORS preflight OPTIONS request for a public widget endpoint. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/** Add the public CORS headers to an outgoing response. */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
