import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentAgent } from "@/lib/auth";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account · One Inbox" };

export default async function SignupPage() {
  if (await getCurrentAgent()) redirect("/inbox");

  return (
    <main className="centered">
      <section className="card stack">
        <h1>One Inbox</h1>
        <p className="muted">Create a workspace for your team.</p>
        <SignupForm />
        <p className="muted">
          Already have an account? <Link href="/login" className="link">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
