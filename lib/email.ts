/**
 * Transactional email — one thin function over a provider's REST API.
 *
 * Provider: Resend (`https://api.resend.com/emails`), called with `fetch`,
 * no SDK — the same "REST over fetch, no dependency" choice as the LINE
 * adapter. Swap providers by rewriting this file only.
 *
 * When `RESEND_API_KEY` / `EMAIL_FROM` are not set (local dev, previews) the
 * message is written to the server log instead of sent, so the signup and
 * verification flow works end to end without email infrastructure. See
 * docs/decisions.md and .env.example.
 */

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.info(
      `[email] not sent (RESEND_API_KEY / EMAIL_FROM unset)\n` +
        `  to:      ${email.to}\n` +
        `  subject: ${email.subject}\n\n` +
        email.text.replace(/^/gm, "  "),
    );
    return;
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
      }),
    });
  } catch (cause) {
    throw new EmailDeliveryError(
      `email request failed: ${(cause as Error).message}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new EmailDeliveryError(
      `email provider rejected the message (${response.status}): ${detail}`.trim(),
    );
  }
}
