"use server";

import { db } from "@/db";
import { appOrigin } from "@/lib/app-url";
import { requireAgent } from "@/lib/auth";
import { connectLineChannel, ChannelSettingsError } from "@/lib/channel-settings";

export type ConnectLineState = {
  error?: string;
  connected?: { channelId: string; webhookUrl: string };
};

export async function connectLine(
  _prev: ConnectLineState,
  formData: FormData,
): Promise<ConnectLineState> {
  const current = await requireAgent();

  const name = String(formData.get("name") ?? "");
  const channelSecret = String(formData.get("channelSecret") ?? "");
  const channelAccessToken = String(formData.get("channelAccessToken") ?? "");

  let channelId: string;
  try {
    ({ channelId } = await connectLineChannel(
      db,
      { accountId: current.accountId, role: current.role },
      { name, channelSecret, channelAccessToken },
    ));
  } catch (error) {
    if (error instanceof ChannelSettingsError) return { error: error.message };
    throw error;
  }

  const webhookUrl = `${await appOrigin()}/api/channels/${channelId}/inbound`;
  return { connected: { channelId, webhookUrl } };
}
