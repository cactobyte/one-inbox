import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WebhookAuth } from "../verify";
import { verifyWhatsAppWebhook } from "./verify";

const SECRET = "app-secret";
const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function auth(signature: string | null, rawBody = BODY): WebhookAuth {
  return {
    header: (name) =>
      name.toLowerCase() === "x-hub-signature-256" ? signature : null,
    rawBody,
  };
}

describe("verifyWhatsAppWebhook", () => {
  it("accepts a body signed with the app secret", () => {
    expect(
      verifyWhatsAppWebhook(auth(sign(BODY, SECRET)), { appSecret: SECRET }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(BODY, SECRET);
    expect(
      verifyWhatsAppWebhook(auth(signature, BODY + " "), { appSecret: SECRET }),
    ).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(
      verifyWhatsAppWebhook(auth(sign(BODY, "not-the-secret")), {
        appSecret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWhatsAppWebhook(auth(null), { appSecret: SECRET })).toBe(false);
  });

  it("rejects a signature with no sha256= prefix", () => {
    expect(
      verifyWhatsAppWebhook(auth(createHmac("sha256", SECRET).update(BODY).digest("hex")), {
        appSecret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects when the channel config has no app secret", () => {
    expect(verifyWhatsAppWebhook(auth(sign(BODY, SECRET)), {})).toBe(false);
  });

  it("does not throw on a garbage signature of a different length", () => {
    expect(
      verifyWhatsAppWebhook(auth("sha256=!!!"), { appSecret: SECRET }),
    ).toBe(false);
  });
});
