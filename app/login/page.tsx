import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentAgent } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · One Inbox" };

export default async function LoginPage() {
  if (await getCurrentAgent()) redirect("/inbox");

  return (
    <main className="centered">
      <section className="card stack">
        <h1>One Inbox</h1>
        <p className="muted">Sign in to your team inbox.</p>
        <LoginForm />
      </section>
    </main>
  );
}
