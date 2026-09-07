import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyInboundWebhook, type WebhookAuth } from "./verify";

function auth(headers: Record<string, string>, rawBody = "{}"): WebhookAuth {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { header: (name) => lower[name.toLowerCase()] ?? null, rawBody };
}

describe("verifyInboundWebhook — dispatch by channel type", () => {
  it("falls back to the shared-token check for the widget", () => {
    const config = { inboundToken: "tok-abc" };
    expect(
      verifyInboundWebhook("widget", auth({ "x-channel-token": "tok-abc" }), config),
    ).toBe(true);
    expect(
      verifyInboundWebhook("widget", auth({ "x-channel-token": "wrong" }), config),
    ).toBe(false);
  });

  it("uses HMAC signature verification for LINE, not the shared token", () => {
    const rawBody = JSON.stringify({ events: [] });
    const secret = "s3cr3t";
    const signature = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    // A valid LINE signature passes even with no x-channel-token present.
    expect(
      verifyInboundWebhook(
        "line",
        auth({ "x-line-signature": signature }, rawBody),
        { channelSecret: secret, inboundToken: "irrelevant" },
      ),
    ).toBe(true);

    // A correct shared token does NOT get a LINE webhook through.
    expect(
      verifyInboundWebhook(
        "line",
        auth({ "x-channel-token": "irrelevant" }, rawBody),
        { channelSecret: secret, inboundToken: "irrelevant" },
      ),
    ).toBe(false);
  });

  it("fails closed for a channel type with neither a verifier nor a token", () => {
    expect(verifyInboundWebhook("messenger", auth({}), {})).toBe(false);
  });
});
