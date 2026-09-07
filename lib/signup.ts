import { eq } from "drizzle-orm";

import type { AppDb } from "@/db";
import { account, agent } from "@/db/schema";
import { hashPassword } from "@/lib/password";

/**
 * Self-serve signup (M4): create a new account (tenant) and its first agent,
 * who is the owner. The agent starts unverified — `email_verified_at` is null
 * and login is refused until the emailed link is followed
 * (`markEmailVerified`).
 *
 * This is the only place an account is created outside the seed script.
 * Validation lives here too, so it is covered by tests rather than trapped in
 * a server action.
 */

export type SignupInput = {
  businessName: string;
  name: string;
  email: string;
  password: string;
};

export type SignupErrorCode =
  | "missing_fields"
  | "invalid_email"
  | "weak_password"
  | "email_taken";

export class SignupError extends Error {
  constructor(
    readonly code: SignupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SignupError";
  }
}

export const MIN_PASSWORD_LENGTH = 8;

// Deliberately loose — the real check is the verification email landing.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise then validate raw form values. Throws `SignupError`. */
export function parseSignup(raw: {
  businessName?: unknown;
  name?: unknown;
  email?: unknown;
  password?: unknown;
}): SignupInput {
  const businessName = String(raw.businessName ?? "").trim();
  const name = String(raw.name ?? "").trim();
  const email = String(raw.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(raw.password ?? "");

  if (!businessName || !name || !email || !password) {
    throw new SignupError("missing_fields", "All fields are required.");
  }
  if (!EMAIL_RE.test(email)) {
    throw new SignupError("invalid_email", "Enter a valid email address.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new SignupError(
      "weak_password",
      `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
    );
  }
  return { businessName, name, email, password };
}

export type SignupResult = { accountId: string; agentId: string };

/**
 * Create the account and its owner agent in one transaction. `email` must
 * already be normalised (use `parseSignup`). Throws `SignupError("email_taken")`
 * if the address is in use — `agent.email` is globally unique for now (see
 * docs/decisions.md, M3).
 */
export async function registerAccount(
  db: AppDb,
  input: SignupInput,
): Promise<SignupResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.transaction(async (tx): Promise<SignupResult> => {
      const existing = await tx
        .select({ id: agent.id })
        .from(agent)
        .where(eq(agent.email, input.email))
        .limit(1);
      if (existing.length > 0) {
        throw new SignupError("email_taken", "That email is already registered.");
      }

      const [acct] = await tx
        .insert(account)
        .values({ name: input.businessName })
        .returning({ id: account.id });

      const [row] = await tx
        .insert(agent)
        .values({
          accountId: acct.id,
          email: input.email,
          passwordHash,
          name: input.name,
          role: "owner",
        })
        .returning({ id: agent.id });

      return { accountId: acct.id, agentId: row.id };
    });
  } catch (error) {
    // Lost the check-then-insert race: the unique index on agent.email fired.
    if (
      error instanceof Error &&
      /duplicate key value|unique constraint/i.test(error.message)
    ) {
      throw new SignupError("email_taken", "That email is already registered.");
    }
    throw error;
  }
}

/**
 * Look up an agent by email for the "resend verification" flow. Returns null
 * for an unknown address or one that is already verified — the caller sends
 * the same "check your inbox" response either way, so a stranger cannot use
 * this to probe which emails have accounts.
 */
export async function findUnverifiedAgent(
  db: AppDb,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const [row] = await db
    .select({ id: agent.id, email: agent.email, verifiedAt: agent.emailVerifiedAt })
    .from(agent)
    .where(eq(agent.email, email.trim().toLowerCase()))
    .limit(1);
  if (!row || row.verifiedAt) return null;
  return { id: row.id, email: row.email };
}
