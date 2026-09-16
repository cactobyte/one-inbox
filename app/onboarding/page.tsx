import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { getOnboardingStatus } from "@/lib/onboarding";

export const metadata: Metadata = { title: "Get started · One Inbox" };

/**
 * First-login experience (M10): shown once, right after a new owner verifies
 * their email (see `app/verify/route.ts`). Walks them through the two things
 * an empty account needs — connect a channel, invite a teammate — both of
 * which are owner-only actions already built (M6, M7), so this page is just
 * a status view over `lib/onboarding.ts` plus links to the real pages.
 * Nothing here is required: "Skip for now" always works, and the same
 * checklist stays reachable later from the inbox nav (`app/inbox/page.tsx`)
 * until both steps are done.
 */
export default async function OnboardingPage() {
  const agent = await requireAgent();
  const status = await getOnboardingStatus(db, agent.accountId);

  return (
    <div className="app">
      <header className="topbar">
        <strong>One Inbox</strong>
        <span className="muted">Let&apos;s get your account set up</span>
      </header>

      <main className="team-main stack">
        <ul className="team-list">
          <li className="team-row">
            <div className="team-row-info">
              <span className="team-name">Connect a channel</span>
              <span className="muted">
                Link a LINE Official Account so customer messages start
                landing in your inbox.
              </span>
            </div>
            <div className="team-row-meta">
              <span className="chan" data-status={status.channelConnected ? "enabled" : "disabled"}>
                {status.channelConnected ? "done" : "not done"}
              </span>
              <Link href="/settings/channels" className="link">
                {status.channelConnected ? "Manage" : "Connect"}
              </Link>
            </div>
          </li>

          <li className="team-row">
            <div className="team-row-info">
              <span className="team-name">Invite a teammate</span>
              <span className="muted">
                Bring in whoever else will be working the inbox with you.
              </span>
            </div>
            <div className="team-row-meta">
              <span className="chan" data-status={status.teammateInvited ? "enabled" : "disabled"}>
                {status.teammateInvited ? "done" : "not done"}
              </span>
              <Link href="/team" className="link">
                {status.teammateInvited ? "Manage" : "Invite"}
              </Link>
            </div>
          </li>
        </ul>

        <p>
          <Link href="/inbox" className="link">
            {status.complete ? "Go to inbox" : "Skip for now — go to inbox"}
          </Link>
        </p>
      </main>
    </div>
  );
}
