"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Posts to the existing day 2 endpoint (POST /api/conversations/:id/messages)
 * — the one send path. This form is just another caller of it, the same as
 * the widget's own send call.
 *
 * "Suggest reply" (M14) only ever fills the textarea — the agent still
 * reviews, edits and clicks Send themselves; nothing is sent automatically.
 */
export function ReplyForm({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/suggest-reply`, {
      method: "POST",
    });
    setSuggesting(false);

    const body = (await res.json().catch(() => null)) as
      | { data?: { suggestion?: string }; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.data?.suggestion) {
      setError(body?.error?.message ?? "Couldn't suggest a reply");
      return;
    }
    setValue(body.data.suggestion);
  }

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
      <div className="reply-form-actions">
        <button
          type="button"
          className="link"
          onClick={() => void handleSuggest()}
          disabled={pending || suggesting}
        >
          {suggesting ? "Thinking…" : "Suggest reply"}
        </button>
        <button type="submit" disabled={pending || value.trim() === ""}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
