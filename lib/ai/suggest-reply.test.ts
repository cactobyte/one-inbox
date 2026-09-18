import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../inbox/errors";
import { suggestReply } from "./suggest-reply";

describe("suggestReply", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the transcript and returns the trimmed suggestion", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "  Sure, 6pm works!  " }] } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await suggestReply([
      { direction: "inbound", body: "Are you open at 6pm?" },
    ]);

    expect(result).toBe("Sure, 6pm works!");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].text).toContain("Customer: Are you open at 6pm?");
    expect(body.systemInstruction.parts[0].text).toMatch(/same language/);
  });

  it("only sends the most recent messages, not the full history", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const messages = Array.from({ length: 15 }, (_, i) => ({
      direction: i % 2 === 0 ? ("inbound" as const) : ("outbound" as const),
      body: `message ${i}`,
    }));

    await suggestReply(messages);

    const [, init] = fetchMock.mock.calls[0];
    const promptText = JSON.parse(init.body as string).contents[0].parts[0].text as string;
    expect(promptText).not.toContain("message 0\n");
    expect(promptText).toContain("message 14");
  });

  it("rejects a conversation with no customer message yet", async () => {
    await expect(
      suggestReply([{ direction: "outbound", body: "Welcome!" }]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an empty conversation", async () => {
    await expect(suggestReply([])).rejects.toBeInstanceOf(ValidationError);
  });
});
