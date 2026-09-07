import { eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { agent } from "@/db/schema";
import { bumpSessionEpoch } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { createSignedToken, readSignedToken } from "@/lib/signed-token";
import { MIN_PASSWORD_LENGTH } from "@/lib/signup";

/**
 * Password reset (M5): "forgot password" emails a short-lived signed link;
 * following it lets the agent set a new password. Completing a reset bumps
 * `session_epoch` (M3), so every existing session for that agent is dropped —
 * a reset is also how you lock out someone who had your old password.
 */

const PURPOSE = "password_reset";
// Short — a reset link is more sensitive than a signup confirmation, and the
// agent is acting on it immediately.
const TTL_SECONDS = 60 * 60; // 1 hour

/**
 * The token's subject is `<agentId>.<sessionEpoch at issue>`. Completing a
 * reset bumps the epoch, so the link becomes single-use: a second click (or
 * a stolen already-used link) fails the epoch check in `resetPassword`.
 */
export function createResetToken(agentId: string, sessionEpoch: number): string {
  return createSignedToken(PURPOSE, `${agentId}.${sessionEpoch}`, TTL_SECONDS);
}

/** Returns `{ agentId, epoch }` for a valid token, else null. */
export function readResetToken(
  token: string | undefined,
): { agentId: string; epoch: number } | null {
  const subject = readSignedToken(PURPOSE, token);
  if (!subject) return null;
  const dot = subject.lastIndexOf(".");
  if (dot <= 0) return null;
  const agentId = subject.slice(0, dot);
  const epoch = Number(subject.slice(dot + 1));
  if (!Number.isInteger(epoch)) return null;
  return { agentId, epoch };
}

export class ResetError extends Error {
  constructor(
    readonly code: "invalid_token" | "weak_password",
    message: string,
  ) {
    super(message);
    this.name = "ResetError";
  }
}

/**
 * Look up an agent by email for the "forgot password" flow. Returns null for
 * an unknown address; the caller shows the same "if that's an account, we
 * sent a link" response either way, so this can't be used to probe.
 */
export async function findAgentForReset(
  db: AppDb,
  email: string,
): Promise<{ id: string; email: string; sessionEpoch: number } | null> {
  const [row] = await db
    .select({
      id: agent.id,
      email: agent.email,
      sessionEpoch: agent.sessionEpoch,
    })
    .from(agent)
    .where(eq(agent.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export type ResetResult = { agentId: string; sessionEpoch: number };

/**
 * Set a new password from a valid reset token. Validates the token and the
 * password, writes the new hash, and bumps `session_epoch`. Returns the new
 * epoch so the caller can sign the agent in fresh (they just proved control
 * of the mailbox and chose the password).
 */
export async function resetPassword(
  db: AppDb,
  token: string | undefined,
  newPassword: string,
): Promise<ResetResult> {
  const claims = readResetToken(token);
  if (!claims) {
    throw new ResetError("invalid_token", "This reset link is invalid or has expired.");
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ResetError(
      "weak_password",
      `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const { agentId, epoch } = claims;

  return db.transaction(async (tx): Promise<ResetResult> => {
    const [row] = await tx
      .select({ sessionEpoch: agent.sessionEpoch })
      .from(agent)
      .where(eq(agent.id, agentId))
      .limit(1);
    if (!row) {
      // Token was valid but the agent is gone (deleted account).
      throw new ResetError("invalid_token", "This reset link is no longer valid.");
    }
    // Single-use: the link was minted at a specific epoch; if the epoch has
    // moved on (an earlier reset, a sign-out-everywhere) the link is spent.
    if (row.sessionEpoch !== epoch) {
      throw new ResetError(
        "invalid_token",
        "This reset link has already been used. Request a new one.",
      );
    }

    await tx
      .update(agent)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(agent.id, agentId));

    const sessionEpoch = await bumpSessionEpoch(tx as AppDb, agentId);
    return { agentId, sessionEpoch };
  });
}

/** The reset email body for a given link. */
export function passwordResetEmail(link: string): {
  subject: string;
  text: string;
} {
  return {
    subject: "Reset your One Inbox password",
    text:
      `Someone asked to reset the password for this One Inbox account.\n\n` +
      `Set a new password:\n\n` +
      `${link}\n\n` +
      `The link is valid for 1 hour. If this wasn't you, ignore this email — ` +
      `your password has not changed.`,
  };
}
