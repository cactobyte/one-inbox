import type { Metadata } from "next";

import { logout } from "@/app/login/actions";
import { requireAgent } from "@/lib/auth";

export const metadata: Metadata = { title: "Inbox · One Inbox" };

export default async function InboxPage() {
  const agent = await requireAgent();

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

      <main className="centered">
        <section className="empty stack">
          <h1>No conversations yet</h1>
          <p className="muted">
            When a customer sends a message it lands here. Connect the website
            widget to get started.
          </p>
        </section>
      </main>
    </div>
  );
}
