import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeminiApiError, GeminiConfigError, generateText } from "./gemini";

describe("generateText", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("throws GeminiConfigError when no API key is configured", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateText({ prompt: "hi" })).rejects.toThrow(GeminiConfigError);
  });

  it("sends the prompt and system instruction and returns the reply text", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sure thing!" }] } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateText({ prompt: "Draft a reply", systemInstruction: "Be brief" });

    expect(result).toBe("Sure thing!");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("key=test-key");
    const body = JSON.parse(init.body as string);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "Draft a reply" }] }]);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "Be brief" }] });
  });

  it("throws GeminiApiError when Gemini rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"quota exceeded"}}', { status: 429 })),
    );
    await expect(generateText({ prompt: "hi" })).rejects.toThrow(GeminiApiError);
    await expect(generateText({ prompt: "hi" })).rejects.toThrow(/quota exceeded/);
  });

  it("throws GeminiApiError when the response has no candidate text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), {
            status: 200,
          }),
      ),
    );
    await expect(generateText({ prompt: "hi" })).rejects.toThrow(/SAFETY/);
  });
});
