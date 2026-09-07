import type { Metadata } from "next";
import Link from "next/link";

import { readResetToken } from "@/lib/password-reset";

import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Set a new password · One Inbox" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valid = readResetToken(token);

  return (
    <main className="centered">
      <section className="card stack">
        <h1>One Inbox</h1>
        {valid && token ? (
          <>
            <p className="muted">Choose a new password for your account.</p>
            <ResetForm token={token} />
          </>
        ) : (
          <>
            <p role="alert" className="error">
              This reset link is invalid or has expired.
            </p>
            <p className="muted">
              <Link href="/forgot-password" className="link">
                Request a new one
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
