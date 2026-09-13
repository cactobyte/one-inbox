"use client";

import { useActionState } from "react";

import { acceptInvite, type AcceptInviteState } from "./actions";

const initialState: AcceptInviteState = {};

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvite, initialState);

  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />

      <label className="stack" htmlFor="name">
        <span>Your name</span>
        <input id="name" name="name" type="text" autoComplete="name" required />
      </label>

      <label className="stack" htmlFor="password">
        <span>Password</span>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>

      <label className="stack" htmlFor="confirm">
        <span>Confirm password</span>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>

      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join the team"}
      </button>
    </form>
  );
}
