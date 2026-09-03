import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { agent } from "@/db/schema";

import { getSessionAgentId } from "./session";

export type CurrentAgent = {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: string;
};

/** The signed-in agent, or null. Every caller stays scoped to accountId. */
export async function getCurrentAgent(): Promise<CurrentAgent | null> {
  const agentId = await getSessionAgentId();
  if (!agentId) return null;

  const [row] = await db
    .select({
      id: agent.id,
      accountId: agent.accountId,
      email: agent.email,
      name: agent.name,
      role: agent.role,
    })
    .from(agent)
    .where(eq(agent.id, agentId))
    .limit(1);

  return row ?? null;
}

/** Use in protected pages: returns the agent or redirects to /login. */
export async function requireAgent(): Promise<CurrentAgent> {
  const current = await getCurrentAgent();
  if (!current) redirect("/login");
  return current;
}
