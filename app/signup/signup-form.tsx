"use client";

import { useActionState } from "react";

import { signup, type SignupState } from "./actions";

const initialState: SignupState = {};

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, initialState);

  if (state.done) {
    return (
      <p role="status" className="stack">
        <strong>Check your email.</strong>
        <span className="muted">
          We sent a confirmation link to finish setting up your account. It is
          valid for 24 hours.
        </span>
      </p>
    );
  }

  return (
    <form action={action} className="stack">
      <label className="stack" htmlFor="businessName">
        <span>Business name</span>
        <input id="businessName" name="businessName" type="text" required />
      </label>

      <label className="stack" htmlFor="name">
        <span>Your name</span>
        <input id="name" name="name" type="text" autoComplete="name" required />
      </label>

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

      {state.error ? (
        <p role="alert" className="error">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
