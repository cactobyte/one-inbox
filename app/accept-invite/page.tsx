import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/db";
import { account, agent } from "@/db/schema";
import { readInviteToken } from "@/lib/team";

import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Join your team · One Inbox" };

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const agentId = readInviteToken(token);

  let invite: { email: string; accountName: string } | null = null;
  if (agentId) {
    const [row] = await db
      .select({
        email: agent.email,
        emailVerifiedAt: agent.emailVerifiedAt,
        accountName: account.name,
      })
      .from(agent)
      .innerJoin(account, eq(account.id, agent.accountId))
      .where(eq(agent.id, agentId))
      .limit(1);
    // Already accepted, or the row is gone: treat the same as an invalid link.
    if (row && !row.emailVerifiedAt) {
      invite = { email: row.email, accountName: row.accountName };
    }
  }

  return (
    <main className="centered">
      <section className="card stack">
        <h1>One Inbox</h1>
        {invite && token ? (
          <>
            <p className="muted">
              You&apos;re invited to join <strong>{invite.accountName}</strong> as{" "}
              {invite.email}. Set your name and a password to join.
            </p>
            <AcceptForm token={token} />
          </>
        ) : (
          <>
            <p role="alert" className="error">
              This invite link is invalid, expired, or already used.
            </p>
            <p className="muted">
              <Link href="/login" className="link">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
