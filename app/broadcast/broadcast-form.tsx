"use client";

import { useState, type FormEvent } from "react";

import type { BroadcastRecipientResult, BroadcastTarget } from "@/lib/broadcast";

/** Posts to POST /api/broadcasts — the bulk-send version of the reply endpoint. */
export function BroadcastForm({ targets }: { targets: BroadcastTarget[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BroadcastRecipientResult[] | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === targets.length ? new Set() : new Set(targets.map((t) => t.id)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || selected.size === 0) return;

    setPending(true);
    setError(null);
    setResults(null);
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactIds: [...selected], body: text }),
    });
    setPending(false);

    const data = (await res.json().catch(() => null)) as
      | { data?: { results: BroadcastRecipientResult[] } }
      | { error?: { message?: string } }
      | null;

    if (!res.ok) {
      setError((data as { error?: { message?: string } })?.error?.message ?? "Failed to send");
      return;
    }
    setResults((data as { data: { results: BroadcastRecipientResult[] } }).data.results);
    setBody("");
    setSelected(new Set());
  }

  const nameById = new Map(targets.map((t) => [t.id, t.displayName]));

  return (
    <form className="stack" onSubmit={(e) => void handleSubmit(e)}>
      <div className="broadcast-targets stack">
        <label className="broadcast-target">
          <input
            type="checkbox"
            checked={targets.length > 0 && selected.size === targets.length}
            onChange={toggleAll}
          />
          <span>Select all ({targets.length})</span>
        </label>
        <ul className="broadcast-target-list">
          {targets.map((t) => (
            <li key={t.id}>
              <label className="broadcast-target">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span>{t.displayName}</span>
                <span className="chan" data-channel={t.channel.type}>
                  {t.channel.name}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message to broadcast…"
        disabled={pending}
      />

      {error ? <p className="error">{error}</p> : null}

      <button type="submit" disabled={pending || body.trim() === "" || selected.size === 0}>
        {pending ? "Sending…" : `Send to ${selected.size} contact${selected.size === 1 ? "" : "s"}`}
      </button>

      {results ? (
        <ul className="broadcast-results stack" role="status">
          {results.map((r) => (
            <li key={r.contactId} data-status={r.status}>
              {nameById.get(r.contactId) ?? r.contactId} —{" "}
              {r.status === "sent" ? "sent" : `failed: ${r.error}`}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
