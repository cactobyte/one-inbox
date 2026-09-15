"use client";

import { useActionState } from "react";

import { reconnectLine, type ReconnectLineState } from "./actions";

const initialState: ReconnectLineState = {};

export function ReconnectLineForm({ channelId }: { channelId: string }) {
  const [state, action, pending] = useActionState(reconnectLine, initialState);

  if (state.done) {
    return (
      <p role="status" className="muted">
        Credentials updated.
      </p>
    );
  }

  return (
    <form action={action} className="stack">
      <input type="hidden" name="channelId" value={channelId} />

      <label className="stack" htmlFor={`reconnect-secret-${channelId}`}>
        <span>New channel secret</span>
        <input
          id={`reconnect-secret-${channelId}`}
          name="channelSecret"
          type="password"
          required
        />
      </label>

      <label className="stack" htmlFor={`reconnect-token-${channelId}`}>
        <span>New channel access token</span>
        <input
          id={`reconnect-token-${channelId}`}
          name="channelAccessToken"
          type="password"
          required
        />
      </label>

      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Updating…" : "Update credentials"}
      </button>
    </form>
  );
}
