"use server";

import { db } from "@/db";
import { appOrigin } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";
import {
  createResetToken,
  findAgentForReset,
  passwordResetEmail,
} from "@/lib/password-reset";

export type ForgotState = { sent?: boolean; error?: string };

/**
 * "Forgot password": email a reset link. Always reports the same result
 * whether or not the address has an account — no enumeration.
 */
export async function requestReset(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const agent = await findAgentForReset(db, email);
  if (agent) {
    const token = createResetToken(agent.id, agent.sessionEpoch);
    const link = `${await appOrigin()}/reset-password?token=${token}`;
    const { subject, text } = passwordResetEmail(link);
    try {
      await sendEmail({ to: agent.email, subject, text });
    } catch {
      // Reported the same either way; a resend is a page refresh away.
    }
  }

  return { sent: true };
}
