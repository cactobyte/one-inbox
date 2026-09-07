"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { agent } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import { clearSessionCookie, setSessionCookie } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const [row] = await db
    .select({
      id: agent.id,
      passwordHash: agent.passwordHash,
      sessionEpoch: agent.sessionEpoch,
    })
    .from(agent)
    .where(eq(agent.email, email))
    .limit(1);

  // Same message and roughly the same work whether or not the email exists.
  const ok = row ? await verifyPassword(password, row.passwordHash) : false;
  if (!row || !ok) {
    return { error: "Email or password is incorrect." };
  }

  await setSessionCookie(row.id, row.sessionEpoch);
  redirect("/inbox");
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
