"use client";

import { useActionState } from "react";

import { connectLine, type ConnectLineState } from "./actions";

const initialState: ConnectLineState = {};

export function ConnectLineForm() {
  const [state, action, pending] = useActionState(connectLine, initialState);

  if (state.connected) {
    return (
      <div role="status" className="stack">
        <strong>LINE channel connected.</strong>
        <p className="muted">
          In the LINE Developers console, set the webhook URL to:
        </p>
        <code className="webhook-url">{state.connected.webhookUrl}</code>
        <p className="muted">
          Turn &quot;Use webhook&quot; on and verify — it should succeed.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
      <label className="stack" htmlFor="line-name">
        <span>Name</span>
        <input id="line-name" name="name" type="text" required />
      </label>

      <label className="stack" htmlFor="line-secret">
        <span>Channel secret</span>
        <input id="line-secret" name="channelSecret" type="password" required />
      </label>

      <label className="stack" htmlFor="line-token">
        <span>Channel access token</span>
        <input id="line-token" name="channelAccessToken" type="password" required />
      </label>

      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Connecting…" : "Connect LINE"}
      </button>
    </form>
  );
}
