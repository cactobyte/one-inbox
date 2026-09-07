"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { checkLogin } from "@/lib/login";
import { clearSessionCookie, setSessionCookie } from "@/lib/session";

export type LoginState = { error?: string; unverifiedEmail?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const outcome = await checkLogin(db, email, password);

  if (outcome.status === "invalid") {
    return { error: "Email or password is incorrect." };
  }
  if (outcome.status === "unverified") {
    // Correct credentials but the email was never confirmed (M4). Surfaced
    // only here — after the password check — so it can't probe accounts.
    return {
      error: "Confirm your email address to sign in — check your inbox.",
      unverifiedEmail: outcome.agent.email,
    };
  }

  await setSessionCookie(outcome.agent.id, outcome.agent.sessionEpoch);
  redirect("/inbox");
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
