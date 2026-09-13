"use client";

import { useActionState } from "react";

import { invite, type InviteState } from "./actions";

const initialState: InviteState = {};

export function InviteForm() {
  const [state, action, pending] = useActionState(invite, initialState);

  return (
    <form action={action} className="stack invite-form">
      <label className="stack" htmlFor="invite-email">
        <span>Invite by email</span>
        <input id="invite-email" name="email" type="email" required />
      </label>

      <label className="stack" htmlFor="invite-role">
        <span>Role</span>
        <select id="invite-role" name="role" defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </select>
      </label>

      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}
      {state.sent ? (
        <p role="status" className="muted">
          Invite sent to {state.sent}.
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send invite"}
      </button>
    </form>
  );
}
