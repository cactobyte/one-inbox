import { describe, expect, it } from "vitest";

import { matchWebhookChallenge } from "./handshake";

describe("matchWebhookChallenge", () => {
  const config = { verifyToken: "shh-verify" };

  it("echoes the challenge when mode and token match", () => {
    expect(
      matchWebhookChallenge(
        { mode: "subscribe", token: "shh-verify", challenge: "1234" },
        config,
      ),
    ).toBe("1234");
  });

  it("rejects a wrong token", () => {
    expect(
      matchWebhookChallenge(
        { mode: "subscribe", token: "wrong", challenge: "1234" },
        config,
      ),
    ).toBeNull();
  });

  it("rejects a mode other than subscribe", () => {
    expect(
      matchWebhookChallenge(
        { mode: "unsubscribe", token: "shh-verify", challenge: "1234" },
        config,
      ),
    ).toBeNull();
  });

  it("rejects when the channel has no verify token configured", () => {
    expect(
      matchWebhookChallenge(
        { mode: "subscribe", token: "anything", challenge: "1234" },
        {},
      ),
    ).toBeNull();
  });

  it("rejects a missing challenge param", () => {
    expect(
      matchWebhookChallenge({ mode: "subscribe", token: "shh-verify", challenge: null }, config),
    ).toBeNull();
  });
});
