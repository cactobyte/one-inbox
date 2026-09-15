"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { appOrigin } from "@/lib/app-url";
import { requireAgent } from "@/lib/auth";
import {
  ChannelSettingsError,
  connectLineChannel,
  reconnectLineChannel,
  setChannelEnabled,
} from "@/lib/channel-settings";

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

/** Owner-only: pause or resume a channel. Plain action, no client state. */
export async function toggleChannel(formData: FormData): Promise<void> {
  const current = await requireAgent();
  const channelId = String(formData.get("channelId") ?? "");
  const enabled = formData.get("enabled") === "true";
  await setChannelEnabled(
    db,
    { accountId: current.accountId, role: current.role },
    channelId,
    enabled,
  );
  redirect("/settings/channels");
}

export type ReconnectLineState = { error?: string; done?: boolean };

/** Owner-only: replace a LINE channel's stored credentials. */
export async function reconnectLine(
  _prev: ReconnectLineState,
  formData: FormData,
): Promise<ReconnectLineState> {
  const current = await requireAgent();
  const channelId = String(formData.get("channelId") ?? "");
  const channelSecret = String(formData.get("channelSecret") ?? "");
  const channelAccessToken = String(formData.get("channelAccessToken") ?? "");

  try {
    await reconnectLineChannel(
      db,
      { accountId: current.accountId, role: current.role },
      channelId,
      { channelSecret, channelAccessToken },
    );
  } catch (error) {
    if (error instanceof ChannelSettingsError) return { error: error.message };
    throw error;
  }

  return { done: true };
}
