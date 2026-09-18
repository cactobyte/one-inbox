/**
 * Google Gemini, over its REST API — no SDK dependency. Same "REST over an
 * SDK" choice already made for LINE, Stripe and Resend: one fewer
 * dependency, plain JSON-over-HTTPS. Chosen for M14 specifically because the
 * Gemini API has a real free tier (rate-limited, not a spend-down trial
 * balance), so AI-assisted replies can run indefinitely at $0 — see
 * docs/decisions.md.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Free-tier eligible as of M14 (live-verified against the real API —
// gemini-2.0-flash, the model current at the time this was written, had
// already been retired by Google in favor of this one). If Google
// deprecates this model too, swap the string here — nothing else changes.
const MODEL = "gemini-3.6-flash";

export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigError";
  }
}

export class GeminiApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiApiError";
  }
}

function apiKey(): string {
  const value = process.env.GEMINI_API_KEY;
  if (!value) {
    throw new GeminiConfigError("GEMINI_API_KEY is not set. See .env.example.");
  }
  return value;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
};

/** One `generateContent` call. Not chat state — the caller sends full context each time. */
export async function generateText(input: {
  prompt: string;
  systemInstruction?: string;
}): Promise<string> {
  const key = apiKey();

  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          ...(input.systemInstruction
            ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
            : {}),
        }),
      },
    );
  } catch (cause) {
    throw new GeminiApiError(`Gemini request failed: ${(cause as Error).message}`);
  }

  const body = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `Gemini rejected the request (${response.status})`;
    throw new GeminiApiError(message);
  }

  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.trim() === "") {
    const blockReason = body?.promptFeedback?.blockReason;
    throw new GeminiApiError(
      blockReason ? `Gemini blocked the request (${blockReason})` : "Gemini returned no text",
    );
  }
  return text;
}
