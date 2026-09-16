import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChannelTag } from "@/app/inbox/channel-tag";
import { db } from "@/db";
import { requireAgent } from "@/lib/auth";
import { getOwnedContact, listContactConversations } from "@/lib/contacts";
import { formatRelativeTime } from "@/lib/format-time";
import { NotFoundError } from "@/lib/inbox/errors";

import { saveNotes } from "./actions";

export const metadata: Metadata = { title: "Contact · One Inbox" };

type PageProps = { params: Promise<{ contactId: string }> };

export default async function ContactPage({ params }: PageProps) {
  const agent = await requireAgent();
  const { contactId } = await params;

  let contact;
  let conversations;
  try {
    contact = await getOwnedContact(db, agent.accountId, contactId);
    conversations = await listContactConversations(db, agent.accountId, contactId);
  } catch (error) {
    // Same "foreign id looks like a 404" rule as a conversation id — see
    // app/inbox/[conversationId]/page.tsx.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/inbox" className="link">
          ← Inbox
        </Link>
        <strong>{contact.displayName}</strong>
        <span className="muted">{agent.email}</span>
      </header>

      <main className="contact-main stack">
        <section className="stack">
          <h2>Details</h2>
          <dl className="contact-details">
            <dt>Email</dt>
            <dd>{contact.email ?? <span className="muted">—</span>}</dd>
            <dt>Phone</dt>
            <dd>{contact.phone ?? <span className="muted">—</span>}</dd>
          </dl>
        </section>

        <section className="stack">
          <h2>Notes</h2>
          <form action={saveNotes} className="stack notes-form">
            <input type="hidden" name="contactId" value={contact.id} />
            <textarea
              name="notes"
              defaultValue={contact.notes ?? ""}
              placeholder="Notes on this contact…"
            />
            <button type="submit">Save notes</button>
          </form>
        </section>

        <section className="stack">
          <h2>History across channels</h2>
          {conversations.length === 0 ? (
            <p className="muted">No conversations yet.</p>
          ) : (
            <ul className="conv-list contact-conv-list">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/inbox/${c.id}`} className="conv-row">
                    <div className="conv-row-top">
                      <ChannelTag channel={c.channel} />
                      <span className="conv-row-meta muted">
                        <span className="chan" data-status={c.status}>
                          {c.status}
                        </span>
                        {c.lastMessageAt ? (
                          <time dateTime={c.lastMessageAt.toISOString()}>
                            {formatRelativeTime(c.lastMessageAt)}
                          </time>
                        ) : null}
                      </span>
                    </div>
                    <div className="conv-row-bottom">
                      <span className="conv-preview muted">
                        {c.lastMessage
                          ? `${c.lastMessage.direction === "outbound" ? "You: " : ""}${c.lastMessage.body}`
                          : "No messages yet"}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
