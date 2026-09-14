import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { encryptCredentials } from "@/lib/channel-credentials";

import { resolveChannelConfig } from "./config";

beforeEach(() => {
  process.env.CHANNEL_CREDENTIALS_KEY = randomBytes(32).toString("hex");
});

describe("resolveChannelConfig", () => {
  it("returns the public config as-is when there are no encrypted credentials", () => {
    // The widget's shape: a public inboundToken, nothing encrypted (M7 —
    // it's a publishable identifier, not a secret; see docs/decisions.md).
    const resolved = resolveChannelConfig({
      config: { inboundToken: "tok-abc" },
      credentialsEncrypted: null,
    });
    expect(resolved).toEqual({ inboundToken: "tok-abc" });
  });

  it("merges decrypted credentials into the public config", () => {
    const credentialsEncrypted = encryptCredentials({
      channelSecret: "s3cr3t",
      channelAccessToken: "tok-123",
    });
    const resolved = resolveChannelConfig({ config: {}, credentialsEncrypted });
    expect(resolved).toEqual({ channelSecret: "s3cr3t", channelAccessToken: "tok-123" });
  });

  it("treats a missing config as empty rather than throwing", () => {
    expect(resolveChannelConfig({ config: null, credentialsEncrypted: null })).toEqual({});
  });
});
