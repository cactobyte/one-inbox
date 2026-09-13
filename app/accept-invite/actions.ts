"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { acceptInvite as acceptInviteRow, TeamError } from "@/lib/team";
import { setSessionCookie } from "@/lib/session";

export type AcceptInviteState = { error?: string };

export async function acceptInvite(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) {
    return { error: "The two passwords don't match." };
  }

  let agentId: string;
  let sessionEpoch: number;
  try {
    ({ agentId, sessionEpoch } = await acceptInviteRow(db, token, { name, password }));
  } catch (error) {
    if (error instanceof TeamError) return { error: error.message };
    throw error;
  }

  await setSessionCookie(agentId, sessionEpoch);
  redirect("/inbox");
}
