import type { Metadata } from "next";
import Link from "next/link";

import { logout } from "@/app/login/actions";
import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format-time";
import { listConversations } from "@/lib/inbox/queries";

export const metadata: Metadata = { title: "Inbox · One Inbox" };

export default async function InboxPage() {
  const agent = await requireAgent();
  const { items } = await listConversations(db, agent.accountId);

  return (
    <div className="app">
      <header className="topbar">
        <strong>One Inbox</strong>
        <span className="muted">{agent.email}</span>
        <form action={logout}>
          <button type="submit" className="link">
            Sign out
          </button>
        </form>
      </header>

      {items.length === 0 ? (
        <main className="centered">
          <section className="empty stack">
            <h1>No conversations yet</h1>
            <p className="muted">
              When a customer sends a message it lands here. Connect the
              website widget to get started.
            </p>
          </section>
        </main>
      ) : (
        <main>
          <ul className="conv-list">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/inbox/${c.id}`} className="conv-row">
                  <div className="conv-row-top">
                    <span className="conv-name">{c.contact.displayName}</span>
                    {c.lastMessageAt ? (
                      <time
                        className="muted"
                        dateTime={c.lastMessageAt.toISOString()}
                      >
                        {formatRelativeTime(c.lastMessageAt)}
                      </time>
                    ) : null}
                  </div>
                  <div className="conv-row-bottom">
                    <span className="conv-preview muted">
                      {c.lastMessage
                        ? `${c.lastMessage.direction === "outbound" ? "You: " : ""}${c.lastMessage.body}`
                        : "No messages yet"}
                    </span>
                    {c.unreadCount > 0 ? (
                      <span className="badge">{c.unreadCount}</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </main>
      )}
    </div>
  );
}
