"use client";

import { useActionState } from "react";

import { submitReset, type ResetState } from "./actions";

const initialState: ResetState = {};

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitReset, initialState);

  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />

      <label className="stack" htmlFor="password">
        <span>New password</span>
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
        <span>Confirm new password</span>
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
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
