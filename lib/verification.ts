import { createHmac, timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { agent } from "@/db/schema";

/**
 * Email-verification links, stateless.
 *
 * Same shape as the session cookie (`lib/session.ts`): a signed
 * `base64url(payload).sig` token, no table. The payload carries
 * `prp: "email_verify"` so a token minted for one purpose can never be
 * replayed as the other — a session cookie is not a verification link and
 * vice versa. Signed with SESSION_SECRET; a 24-hour expiry.
 */

const PURPOSE = "email_verify";
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

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

export function createVerificationToken(agentId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ sub: agentId, prp: PURPOSE, exp }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The agent id if the token is well-formed, signed, unexpired and for this
 * purpose — else null. */
export function readVerificationToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;

  try {
    const { sub, prp, exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as { sub?: string; prp?: string; exp?: number };
    if (!sub || prp !== PURPOSE || !exp || exp * 1000 < Date.now()) return null;
    return sub;
  } catch {
    return null;
  }
}

/**
 * Mark an agent's email verified. Idempotent — a second click on the link (or
 * a race between two clicks) is a no-op, and the caller can still sign the
 * agent in. Returns true if the agent exists.
 */
export async function markEmailVerified(
  db: AppDb,
  agentId: string,
): Promise<boolean> {
  const rows = await db
    .update(agent)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(agent.id, agentId))
    .returning({ id: agent.id });
  return rows.length > 0;
}

/** The verification email body for a given confirmation link. */
export function verificationEmail(link: string): {
  subject: string;
  text: string;
} {
  return {
    subject: "Confirm your email for One Inbox",
    text:
      `Welcome to One Inbox.\n\n` +
      `Confirm this email address to finish setting up your account:\n\n` +
      `${link}\n\n` +
      `The link is valid for 24 hours. If you didn't create an account, ignore this email.`,
  };
}
