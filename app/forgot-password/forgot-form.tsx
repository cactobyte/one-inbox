"use client";

import { useActionState } from "react";

import { requestReset, type ForgotState } from "./actions";

const initialState: ForgotState = {};

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestReset, initialState);

  if (state.sent) {
    return (
      <p role="status" className="muted">
        If that email has an account, a reset link is on its way. It is valid
        for 1 hour.
      </p>
    );
  }

  return (
    <form action={action} className="stack">
      <label className="stack" htmlFor="email">
        <span>Email</span>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </label>

      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
