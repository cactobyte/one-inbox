import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Stateless agent sessions.
 *
 * CLAUDE.md fixes the data model at seven tables, so there is no `session`
 * table. Instead the session is a signed cookie: `base64url(payload).sig`
 * where the payload is `{ sub: agentId, epc: sessionEpoch, exp: epochSeconds }`
 * and the signature is HMAC-SHA256 over the payload keyed with SESSION_SECRET.
 *
 * Two levels of revocation:
 *  - Every session at once: rotate SESSION_SECRET.
 *  - One agent's sessions: bump `agent.session_epoch` (see
 *    `bumpSessionEpoch` in lib/auth.ts). `getCurrentAgent` compares the
 *    cookie's `epc` to the row and rejects a mismatch.
 */

export const SESSION_COOKIE = "oi_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionClaims = { agentId: string; epoch: number };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. See .env.example.",
    );
  }
  return value;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createSessionToken(agentId: string, epoch: number): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ sub: agentId, epc: epoch, exp }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * The claims if the token is well-formed, signed and unexpired — else null.
 * Does not check `epoch` against the database; the caller does that with the
 * agent row (see `getCurrentAgent`).
 */
export function readSessionToken(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;

  try {
    const { sub, epc, exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { sub?: string; epc?: number; exp?: number };
    if (!sub || !exp || exp * 1000 < Date.now()) return null;
    return { agentId: sub, epoch: typeof epc === "number" ? epc : 0 };
  } catch {
    return null;
  }
}

export async function setSessionCookie(
  agentId: string,
  epoch: number,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(agentId, epoch), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionClaims(): Promise<SessionClaims | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}
