import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { agent } from "@/db/schema";
import { setSessionCookie } from "@/lib/session";
import { markEmailVerified, readVerificationToken } from "@/lib/verification";

/**
 * The target of the confirmation link in the signup email:
 * `/verify?token=<signed token>`.
 *
 * Marks the agent's email verified (idempotent — a second click is fine),
 * signs them in, and drops them at the inbox. A bad or expired token sends
 * them to sign-in with a note offering to resend.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? undefined;
  const agentId = readVerificationToken(token);

  const fail = NextResponse.redirect(new URL("/login?verify=invalid", request.url));
  if (!agentId) return fail;

  const [row] = await db
    .select({ id: agent.id, sessionEpoch: agent.sessionEpoch })
    .from(agent)
    .where(eq(agent.id, agentId))
    .limit(1);
  if (!row) return fail;

  await markEmailVerified(db, row.id);
  await setSessionCookie(row.id, row.sessionEpoch);

  return NextResponse.redirect(new URL("/inbox", request.url));
}
