"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { resetPassword, ResetError } from "@/lib/password-reset";
import { setSessionCookie } from "@/lib/session";

export type ResetState = { error?: string };

/**
 * Set the new password. Re-validates the token (it rode in a hidden field
 * from the page), writes the hash, drops every existing session for the
 * agent, then signs them in fresh and sends them to the inbox.
 */
export async function submitReset(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) {
    return { error: "The two passwords don't match." };
  }

  let agentId: string;
  let sessionEpoch: number;
  try {
    ({ agentId, sessionEpoch } = await resetPassword(db, token, password));
  } catch (error) {
    if (error instanceof ResetError) return { error: error.message };
    throw error;
  }

  await setSessionCookie(agentId, sessionEpoch);
  redirect("/inbox");
}
