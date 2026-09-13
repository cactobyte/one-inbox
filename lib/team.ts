import { randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { AppDb } from "@/db";
import { agent, type AgentRole } from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { createSignedToken, readSignedToken } from "@/lib/signed-token";
import { MIN_PASSWORD_LENGTH } from "@/lib/signup";

/**
 * Team management (M6): an owner invites a teammate by email; the invite is
 * a pending `agent` row (no separate table) that becomes real once the
 * invitee follows the link and sets a password.
 *
 * `agent.email` stays globally unique (see docs/decisions.md, M6 — the M3
 * deferral is resolved here, not redesigned): one person is one agent in one
 * account. Inviting an email that already has an agent row *anywhere* —
 * active or still-pending — is rejected. Real multi-account membership would
 * need `unique(account_id, email)` plus a login-time account picker; out of
 * scope, backlogged.
 */

const INVITE_PURPOSE = "team_invite";
const INVITE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — invites sit around

export type InvitableRole = Exclude<AgentRole, "owner">;

export function createInviteToken(agentId: string): string {
  return createSignedToken(INVITE_PURPOSE, agentId, INVITE_TTL_SECONDS);
}

export function readInviteToken(token: string | undefined): string | null {
  return readSignedToken(INVITE_PURPOSE, token);
}

export class TeamError extends Error {
  constructor(
    readonly code:
      | "not_owner"
      | "invalid_role"
      | "email_taken"
      | "invalid_token"
      | "invalid_name"
      | "weak_password"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: AgentRole;
  status: "active" | "invited";
};

/** Every agent on an account, owner first, then by name. */
export async function listTeam(db: AppDb, accountId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      emailVerifiedAt: agent.emailVerifiedAt,
    })
    .from(agent)
    .where(eq(agent.accountId, accountId));

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      status: (r.emailVerifiedAt ? "active" : "invited") as TeamMember["status"],
    }))
    .sort((a, b) =>
      a.role === b.role ? a.name.localeCompare(b.name) : a.role === "owner" ? -1 : 1,
    );
}

/**
 * Invite `email` into `accountId` with `role`. Only an owner may invite
 * (checked against the DB, not trusted from the caller). Creates a pending
 * `agent` row — unusable password hash, `email_verified_at` null — and
 * returns its id and a fresh invite token to email out.
 *
 * `agent.name` starts as the email; the invitee sets their real name when
 * they accept.
 */
export async function inviteTeammate(
  db: AppDb,
  inviter: { accountId: string; role: AgentRole },
  input: { email: string; role: InvitableRole },
): Promise<{ agentId: string; token: string }> {
  if (inviter.role !== "owner") {
    throw new TeamError("not_owner", "Only the account owner can invite teammates.");
  }
  if (input.role !== "admin" && input.role !== "agent") {
    throw new TeamError("invalid_role", 'Role must be "admin" or "agent".');
  }

  const email = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: agent.id })
      .from(agent)
      .where(eq(agent.email, email))
      .limit(1);
    if (existing.length > 0) {
      throw new TeamError(
        "email_taken",
        "That email already has a One Inbox account — it can't be invited again.",
      );
    }

    // Unguessable, never returned to anyone: this row can't be logged into
    // until accept-invite overwrites it with a real hash.
    const placeholderHash = await hashPassword(randomBytes(32).toString("hex"));

    const [row] = await tx
      .insert(agent)
      .values({
        accountId: inviter.accountId,
        email,
        passwordHash: placeholderHash,
        name: email,
        role: input.role,
      })
      .returning({ id: agent.id });

    return { agentId: row.id, token: createInviteToken(row.id) };
  });
}

export type AcceptResult = { agentId: string; accountId: string; sessionEpoch: number };

/**
 * Accept an invite: set the real name and password. Only works once — the
 * check is `email_verified_at IS NULL`, the same flag a re-click on an
 * already-accepted signup-verification link would trip (M4), done inside
 * the transaction so a race between two clicks can't double-accept.
 */
export async function acceptInvite(
  db: AppDb,
  token: string | undefined,
  input: { name: string; password: string },
): Promise<AcceptResult> {
  const agentId = readInviteToken(token);
  if (!agentId) {
    throw new TeamError("invalid_token", "This invite link is invalid or has expired.");
  }

  const name = input.name.trim();
  if (!name) {
    throw new TeamError("invalid_name", "Enter your name.");
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new TeamError(
      "weak_password",
      `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx): Promise<AcceptResult> => {
    const [row] = await tx
      .select({
        accountId: agent.accountId,
        emailVerifiedAt: agent.emailVerifiedAt,
        sessionEpoch: agent.sessionEpoch,
      })
      .from(agent)
      .where(eq(agent.id, agentId))
      .limit(1);
    if (!row) {
      throw new TeamError("invalid_token", "This invite is no longer valid.");
    }
    if (row.emailVerifiedAt) {
      throw new TeamError(
        "invalid_token",
        "This invite has already been accepted. Sign in instead.",
      );
    }

    await tx
      .update(agent)
      .set({ name, passwordHash, emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(agent.id, agentId));

    return { agentId, accountId: row.accountId, sessionEpoch: row.sessionEpoch };
  });
}

/**
 * Cancel a pending invite — an owner-only cleanup for a mistyped address, so
 * it isn't stuck occupying that email forever. The `email_verified_at IS
 * NULL` condition is *in* the `DELETE`'s `WHERE`, not checked separately, so
 * it is race-safe: a concurrent accept that commits first flips the column
 * and this delete simply matches nothing. An active teammate can never be
 * removed through this path — that is a real "remove from team" feature
 * (reassigning their conversations etc.), out of scope here.
 */
export async function cancelInvite(
  db: AppDb,
  accountId: string,
  agentId: string,
): Promise<void> {
  const rows = await db
    .delete(agent)
    .where(
      and(
        eq(agent.id, agentId),
        eq(agent.accountId, accountId),
        isNull(agent.emailVerifiedAt),
      ),
    )
    .returning({ id: agent.id });

  if (rows.length === 0) {
    throw new TeamError("not_found", "Invite not found.");
  }
}

/** A fresh invite token for a still-pending row, for a "resend" action. */
export async function reissueInvite(
  db: AppDb,
  accountId: string,
  agentId: string,
): Promise<string> {
  const [row] = await db
    .select({ emailVerifiedAt: agent.emailVerifiedAt })
    .from(agent)
    .where(and(eq(agent.id, agentId), eq(agent.accountId, accountId)))
    .limit(1);
  if (!row || row.emailVerifiedAt) {
    throw new TeamError("not_found", "Invite not found.");
  }
  return createInviteToken(agentId);
}

/** The invite email body. */
export function inviteEmail(
  link: string,
  accountName: string,
): { subject: string; text: string } {
  return {
    subject: `You're invited to ${accountName} on One Inbox`,
    text:
      `You've been invited to join "${accountName}"'s team inbox on One Inbox.\n\n` +
      `Set up your account:\n\n` +
      `${link}\n\n` +
      `The link is valid for 7 days. If you weren't expecting this, ignore this email.`,
  };
}
