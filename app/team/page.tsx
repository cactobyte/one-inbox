import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { listTeam } from "@/lib/team";

import { cancelInvite, resendInvite } from "./actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Team · One Inbox" };

export default async function TeamPage() {
  const agent = await requireAgent();
  const members = await listTeam(db, agent.accountId);
  const isOwner = agent.role === "owner";

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/inbox" className="link">
          ← Inbox
        </Link>
        <strong>Team</strong>
        <span className="muted">{agent.email}</span>
      </header>

      <main className="team-main stack">
        <ul className="team-list">
          {members.map((m) => (
            <li key={m.id} className="team-row">
              <div className="team-row-info">
                <span className="team-name">{m.name}</span>
                <span className="muted">{m.email}</span>
              </div>
              <div className="team-row-meta">
                <span className="chan" data-role={m.role}>
                  {m.role}
                </span>
                {m.status === "invited" ? (
                  <span className="chan" data-status="invited">
                    invited
                  </span>
                ) : null}
                {isOwner && m.status === "invited" ? (
                  <>
                    <form action={resendInvite}>
                      <input type="hidden" name="agentId" value={m.id} />
                      <input type="hidden" name="email" value={m.email} />
                      <button type="submit" className="link">
                        Resend
                      </button>
                    </form>
                    <form action={cancelInvite}>
                      <input type="hidden" name="agentId" value={m.id} />
                      <button type="submit" className="link">
                        Cancel
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {isOwner ? (
          <section className="stack">
            <h2>Invite a teammate</h2>
            <InviteForm />
          </section>
        ) : null}
      </main>
    </div>
  );
}
