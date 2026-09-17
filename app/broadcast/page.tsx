import type { Metadata } from "next";
import Link from "next/link";

import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { listBroadcastTargets } from "@/lib/broadcast";

import { BroadcastForm } from "./broadcast-form";

export const metadata: Metadata = { title: "Broadcast · One Inbox" };

export default async function BroadcastPage() {
  const agent = await requireAgent();
  const targets = await listBroadcastTargets(db, agent.accountId);

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/inbox" className="link">
          ← Inbox
        </Link>
        <strong>Broadcast</strong>
        <span className="muted">{agent.email}</span>
      </header>

      <main className="team-main stack">
        {targets.length === 0 ? (
          <p className="muted">No contacts yet — a broadcast needs someone to send to.</p>
        ) : (
          <BroadcastForm targets={targets} />
        )}
      </main>
    </div>
  );
}
