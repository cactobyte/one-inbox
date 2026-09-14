import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { listChannels } from "@/lib/channel-settings";
import { formatRelativeTime } from "@/lib/format-time";

import { ConnectLineForm } from "./connect-line-form";

export const metadata: Metadata = { title: "Channels · One Inbox" };

export default async function ChannelsPage() {
  const agent = await requireAgent();
  const channels = await listChannels(db, agent.accountId);
  const isOwner = agent.role === "owner";

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/inbox" className="link">
          ← Inbox
        </Link>
        <strong>Channels</strong>
        <span className="muted">{agent.email}</span>
      </header>

      <main className="team-main stack">
        <ul className="team-list">
          {channels.map((c) => (
            <li key={c.id} className="team-row">
              <div className="team-row-info">
                <span className="team-name">{c.name}</span>
                <span className="muted">
                  Connected {formatRelativeTime(c.createdAt)}
                </span>
              </div>
              <span className="chan" data-channel={c.type}>
                {c.type}
              </span>
            </li>
          ))}
        </ul>

        {isOwner ? (
          <section className="stack">
            <h2>Connect a LINE Official Account</h2>
            <p className="muted">
              From the LINE Developers console, copy the Messaging API
              channel&apos;s channel secret and a long-lived channel access
              token.
            </p>
            <ConnectLineForm />
          </section>
        ) : null}
      </main>
    </div>
  );
}
