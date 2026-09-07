"use client";

import { useActionState } from "react";

import { resendVerification, type ResendState } from "@/app/signup/actions";

import { login, type LoginState } from "./actions";

const initialLogin: LoginState = {};
const initialResend: ResendState = {};

function ResendVerification({ email }: { email: string }) {
  const [state, action, pending] = useActionState(
    resendVerification,
    initialResend,
  );

  if (state.sent) {
    return (
      <p role="status" className="muted">
        Sent. Check your inbox for the confirmation link.
      </p>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <button type="submit" className="link" disabled={pending}>
        {pending ? "Sending…" : "Resend the confirmation email"}
      </button>
    </form>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initialLogin);

  return (
    // The resend control is a sibling of the login form, not a child — an
    // HTML form cannot be nested inside another.
    <div className="stack">
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

        <label className="stack" htmlFor="password">
          <span>Password</span>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>

        {state.error ? (
          <p role="alert" className="error">
            {state.error}
          </p>
        ) : null}

        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {state.unverifiedEmail ? (
        <ResendVerification email={state.unverifiedEmail} />
      ) : null}
    </div>
  );
}
