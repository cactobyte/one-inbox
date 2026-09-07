import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import type { AppDb } from "@/db";
import { db } from "@/db";
import { agent } from "@/db/schema";

import { getSessionClaims } from "./session";

export type CurrentAgent = {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: string;
};

/**
 * The signed-in agent, or null. Every caller stays scoped to accountId.
 *
 * The session cookie is rejected unless its epoch still matches
 * `agent.session_epoch` — so bumping that column (below) logs the agent out
 * everywhere on the next request.
 */
export async function getCurrentAgent(): Promise<CurrentAgent | null> {
  const claims = await getSessionClaims();
  if (!claims) return null;

  const [row] = await db
    .select({
      id: agent.id,
      accountId: agent.accountId,
      email: agent.email,
      name: agent.name,
      role: agent.role,
      sessionEpoch: agent.sessionEpoch,
    })
    .from(agent)
    .where(eq(agent.id, claims.agentId))
    .limit(1);

  if (!row || row.sessionEpoch !== claims.epoch) return null;

  return {
    id: row.id,
    accountId: row.accountId,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

/**
 * Invalidate every existing session for one agent by advancing its epoch.
 * Returns the new epoch, for minting a fresh cookie in the same request (a
 * password change should not sign *you* out). Used by sign-out-everywhere
 * and, from M5, password reset.
 */
export async function bumpSessionEpoch(
  database: AppDb,
  agentId: string,
): Promise<number> {
  const [row] = await database
    .update(agent)
    .set({ sessionEpoch: sql`${agent.sessionEpoch} + 1`, updatedAt: new Date() })
    .where(eq(agent.id, agentId))
    .returning({ sessionEpoch: agent.sessionEpoch });
  return row?.sessionEpoch ?? 0;
}

/** Use in protected pages: returns the agent or redirects to /login. */
export async function requireAgent(): Promise<CurrentAgent> {
  const current = await getCurrentAgent();
  if (!current) redirect("/login");
  return current;
}
