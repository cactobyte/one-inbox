import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A stateless, single-purpose bearer token: `base64url(payload).sig`, where
 * the payload is `{ sub, prp, exp }` and the signature is HMAC-SHA256 over
 * the payload keyed with `SESSION_SECRET`. No table — the data model is full.
 *
 * `prp` (purpose) is checked on read, so a token minted for one flow can
 * never be replayed in another: an email-verification link is not a
 * password-reset link is not a session.
 *
 * `lib/session.ts` and `lib/verification.ts` predate this and still carry
 * their own copies (session's payload also holds `epc`); folding them onto
 * this is in docs/backlog.md.
 */

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short. See .env.example.");
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

export function createSignedToken(
  purpose: string,
  subject: string,
  ttlSeconds: number,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(
    JSON.stringify({ sub: subject, prp: purpose, exp }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * The subject if the token is well-formed, correctly signed, unexpired and
 * for `purpose` — otherwise null.
 */
export function readSignedToken(
  purpose: string,
  token: string | undefined,
): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;

  try {
    const { sub, prp, exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { sub?: string; prp?: string; exp?: number };
    if (!sub || prp !== purpose || !exp || exp * 1000 < Date.now()) return null;
    return sub;
  } catch {
    return null;
  }
}
