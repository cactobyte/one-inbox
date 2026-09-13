"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { account } from "@/db/schema";
import { appOrigin } from "@/lib/app-url";
import { requireAgent } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import {
  cancelInvite as cancelInviteRow,
  inviteEmail,
  inviteTeammate as inviteTeammateRow,
  reissueInvite,
  TeamError,
  type InvitableRole,
} from "@/lib/team";

export type InviteState = { error?: string; sent?: string };

async function accountName(accountId: string): Promise<string> {
  const [row] = await db
    .select({ name: account.name })
    .from(account)
    .where(eq(account.id, accountId))
    .limit(1);
  return row?.name ?? "your team";
}

export async function invite(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const current = await requireAgent();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "agent") as InvitableRole;

  let result;
  try {
    result = await inviteTeammateRow(
      db,
      { accountId: current.accountId, role: current.role },
      { email, role },
    );
  } catch (error) {
    if (error instanceof TeamError) return { error: error.message };
    throw error;
  }

  const link = `${await appOrigin()}/accept-invite?token=${result.token}`;
  const { subject, text } = inviteEmail(link, await accountName(current.accountId));
  try {
    await sendEmail({ to: email.trim().toLowerCase(), subject, text });
  } catch {
    // The invite row exists either way; "resend" covers a mail hiccup.
  }

  return { sent: email };
}

/** Owner-only: delete a still-pending invite. Plain action, no client state. */
export async function cancelInvite(formData: FormData): Promise<void> {
  const current = await requireAgent();
  const agentId = String(formData.get("agentId") ?? "");
  if (current.role !== "owner") {
    throw new TeamError("not_owner", "Only the account owner can do that.");
  }
  await cancelInviteRow(db, current.accountId, agentId);
  redirect("/team");
}

/** Owner-only: re-send a pending invite with a fresh link. */
export async function resendInvite(formData: FormData): Promise<void> {
  const current = await requireAgent();
  const agentId = String(formData.get("agentId") ?? "");
  const email = String(formData.get("email") ?? "");
  if (current.role !== "owner") {
    throw new TeamError("not_owner", "Only the account owner can do that.");
  }

  const token = await reissueInvite(db, current.accountId, agentId);
  const link = `${await appOrigin()}/accept-invite?token=${token}`;
  const { subject, text } = inviteEmail(link, await accountName(current.accountId));
  try {
    await sendEmail({ to: email, subject, text });
  } catch {
    // Reported the same either way — the owner can hit "resend" again.
  }

  redirect("/team");
}
