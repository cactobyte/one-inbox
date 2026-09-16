import { and, eq, ne } from "drizzle-orm";

import type { AppDb } from "@/db";
import { agent, channel } from "@/db/schema";

/**
 * Onboarding (M10): a brand-new account has two things worth doing before it
 * is useful — connect a channel, invite a teammate. There's no dedicated
 * "onboarding" state on `account`; completeness is derived from data that
 * already exists (any `channel` row, any non-owner `agent` row), the same
 * flag-free style as `channel.disabledAt` elsewhere in the schema.
 */
export type OnboardingStatus = {
  channelConnected: boolean;
  teammateInvited: boolean;
  complete: boolean;
};

export async function getOnboardingStatus(
  db: AppDb,
  accountId: string,
): Promise<OnboardingStatus> {
  const [channelRow, teammateRow] = await Promise.all([
    db
      .select({ id: channel.id })
      .from(channel)
      .where(eq(channel.accountId, accountId))
      .limit(1),
    db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.accountId, accountId), ne(agent.role, "owner")))
      .limit(1),
  ]);

  const channelConnected = channelRow.length > 0;
  const teammateInvited = teammateRow.length > 0;

  return {
    channelConnected,
    teammateInvited,
    complete: channelConnected && teammateInvited,
  };
}
