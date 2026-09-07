"use server";

import { db } from "@/db";
import { appOrigin } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";
import {
  findUnverifiedAgent,
  parseSignup,
  registerAccount,
  SignupError,
} from "@/lib/signup";
import {
  createVerificationToken,
  verificationEmail,
} from "@/lib/verification";

export type SignupState = { error?: string; done?: boolean };

export async function signup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  let input;
  try {
    input = parseSignup({
      businessName: formData.get("businessName"),
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
  } catch (error) {
    if (error instanceof SignupError) return { error: error.message };
    throw error;
  }

  let agentId: string;
  try {
    ({ agentId } = await registerAccount(db, input));
  } catch (error) {
    if (error instanceof SignupError) {
      return {
        error:
          error.code === "email_taken"
            ? "That email is already registered. Sign in instead."
            : error.message,
      };
    }
    throw error;
  }

  const link = `${await appOrigin()}/verify?token=${createVerificationToken(agentId)}`;
  const { subject, text } = verificationEmail(link);
  try {
    await sendEmail({ to: input.email, subject, text });
  } catch {
    // The account exists; don't fail the signup on a mail hiccup. The agent
    // can use "resend" from the sign-in page.
  }

  return { done: true };
}

export type ResendState = { sent?: boolean };

/** Re-send the verification email. Always reports success (no account probing). */
export async function resendVerification(
  _prev: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const email = String(formData.get("email") ?? "");
  const agent = await findUnverifiedAgent(db, email);
  if (agent) {
    const link = `${await appOrigin()}/verify?token=${createVerificationToken(agent.id)}`;
    const { subject, text } = verificationEmail(link);
    try {
      await sendEmail({ to: agent.email, subject, text });
    } catch {
      // Swallow — reported the same either way.
    }
  }
  return { sent: true };
}
