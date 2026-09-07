import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailDeliveryError, sendEmail } from "./email";

const email = {
  to: "nok@example.com",
  subject: "Confirm your email for One Inbox",
  text: "Follow this link: https://app.example/verify?token=abc",
};

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendEmail — no provider configured", () => {
  it("logs the message and sends no request", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(email);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toContain("nok@example.com");
    expect(info.mock.calls[0][0]).toContain("verify?token=abc");
  });
});

describe("sendEmail — Resend configured", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "One Inbox <hello@example.com>";
  });

  it("POSTs the message to the Resend API", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ id: "e-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(email);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer re_test_key",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      from: "One Inbox <hello@example.com>",
      to: "nok@example.com",
      subject: email.subject,
      text: email.text,
    });
  });

  it("throws EmailDeliveryError when the provider rejects the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"bad key"}', { status: 401 })),
    );
    await expect(sendEmail(email)).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
