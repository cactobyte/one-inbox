"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Posts to the existing day 2 endpoint (POST /api/conversations/:id/messages)
 * — the one send path. This form is just another caller of it, the same as
 * the widget's own send call.
 */
export function ReplyForm({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = value.trim();
    if (!body) return;

    setPending(true);
    setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setPending(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(data?.error?.message ?? "Failed to send");
      return;
    }
    setValue("");
    router.refresh(); // re-fetch the server-rendered message list
  }

  return (
    <form className="reply-form" onSubmit={(e) => void handleSubmit(e)}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type a reply…"
        disabled={pending}
      />
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" disabled={pending || value.trim() === ""}>
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
