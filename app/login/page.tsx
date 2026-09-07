import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentAgent } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · One Inbox" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ verify?: string }>;
}) {
  if (await getCurrentAgent()) redirect("/inbox");
  const { verify } = await searchParams;

  return (
    <main className="centered">
      <section className="card stack">
        <h1>One Inbox</h1>
        <p className="muted">Sign in to your team inbox.</p>
        {verify === "invalid" ? (
          <p role="alert" className="error">
            That confirmation link was invalid or has expired. Sign in to have a
            new one sent.
          </p>
        ) : null}
        <LoginForm />
        <p className="muted">
          New here? <Link href="/signup" className="link">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
