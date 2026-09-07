import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WebhookAuth } from "../verify";
import { verifyLineWebhook } from "./verify";

const SECRET = "line-channel-secret";
const BODY = JSON.stringify({ destination: "U_oa", events: [] });

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function auth(signature: string | null, rawBody = BODY): WebhookAuth {
  return {
    header: (name) =>
      name.toLowerCase() === "x-line-signature" ? signature : null,
    rawBody,
  };
}

describe("verifyLineWebhook", () => {
  it("accepts a body signed with the channel secret", () => {
    expect(
      verifyLineWebhook(auth(sign(BODY, SECRET)), { channelSecret: SECRET }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(BODY, SECRET);
    expect(
      verifyLineWebhook(auth(signature, BODY + " "), { channelSecret: SECRET }),
    ).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(
      verifyLineWebhook(auth(sign(BODY, "not-the-secret")), {
        channelSecret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyLineWebhook(auth(null), { channelSecret: SECRET })).toBe(false);
  });

  it("rejects when the channel config has no secret", () => {
    expect(verifyLineWebhook(auth(sign(BODY, SECRET)), {})).toBe(false);
  });

  it("does not throw on a garbage signature of a different length", () => {
    expect(
      verifyLineWebhook(auth("!!!"), { channelSecret: SECRET }),
    ).toBe(false);
  });
});
