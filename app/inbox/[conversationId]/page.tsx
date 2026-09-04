import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { logout } from "@/app/login/actions";
import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/format-time";
import { NotFoundError } from "@/lib/inbox/errors";
import { getOwnedConversation, listMessages } from "@/lib/inbox/queries";

import { ReplyForm } from "./reply-form";

export const metadata: Metadata = { title: "Conversation · One Inbox" };

type PageProps = { params: Promise<{ conversationId: string }> };

export default async function ConversationPage({ params }: PageProps) {
  const agent = await requireAgent();
  const { conversationId } = await params;

  let conversation;
  let messages;
  try {
    conversation = await getOwnedConversation(db, agent.accountId, conversationId);
    ({ items: messages } = await listMessages(db, agent.accountId, conversationId));
  } catch (error) {
    // A foreign or made-up id is indistinguishable from a real 404 — the
    // query layer already refused to say which (lib/inbox/queries.ts).
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/inbox" className="link">
          ← Inbox
        </Link>
        <strong>{conversation.contact.displayName}</strong>
        <span className="muted">{agent.email}</span>
        <form action={logout}>
          <button type="submit" className="link">
            Sign out
          </button>
        </form>
      </header>

      <main className="conv-main">
        <div className="conv-messages">
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.direction}`}>
              <p>{m.body}</p>
              <time className="muted" dateTime={m.sentAt.toISOString()}>
                {formatRelativeTime(m.sentAt)}
              </time>
            </div>
          ))}
        </div>
        <ReplyForm conversationId={conversation.id} />
      </main>
    </div>
  );
}
