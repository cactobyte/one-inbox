import { eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { agent } from "@/db/schema";
import { verifyPassword } from "@/lib/password";

/**
 * Check sign-in credentials. Kept out of the server action so the three
 * outcomes are covered by tests.
 *
 *  - `ok`         — correct email + password, email verified. `agent` is set.
 *  - `unverified` — correct email + password, but the email was never
 *                   confirmed (M4). `agent` is set (the caller offers a resend).
 *  - `invalid`    — wrong email or password. Indistinguishable on purpose.
 *
 * The `unverified` outcome is only reachable *after* the password check, so
 * it cannot be used to probe which addresses have accounts.
 */
export type LoginOutcome =
  | { status: "ok"; agent: { id: string; sessionEpoch: number } }
  | { status: "unverified"; agent: { id: string; email: string } }
  | { status: "invalid" };

export async function checkLogin(
  db: AppDb,
  email: string,
  password: string,
): Promise<LoginOutcome> {
  const normalised = email.trim().toLowerCase();

  const [row] = await db
    .select({
      id: agent.id,
      email: agent.email,
      passwordHash: agent.passwordHash,
      sessionEpoch: agent.sessionEpoch,
      emailVerifiedAt: agent.emailVerifiedAt,
    })
    .from(agent)
    .where(eq(agent.email, normalised))
    .limit(1);

  const ok = row ? await verifyPassword(password, row.passwordHash) : false;
  if (!row || !ok) return { status: "invalid" };

  if (!row.emailVerifiedAt) {
    return { status: "unverified", agent: { id: row.id, email: row.email } };
  }

  return {
    status: "ok",
    agent: { id: row.id, sessionEpoch: row.sessionEpoch },
  };
}
