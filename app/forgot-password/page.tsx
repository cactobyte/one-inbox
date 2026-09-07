import type { Metadata } from "next";
import Link from "next/link";

import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password · One Inbox" };

export default function ForgotPasswordPage() {
  return (
    <main className="centered">
      <section className="card stack">
        <h1>One Inbox</h1>
        <p className="muted">
          Enter your email and we&apos;ll send a link to set a new password.
        </p>
        <ForgotForm />
        <p className="muted">
          <Link href="/login" className="link">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
