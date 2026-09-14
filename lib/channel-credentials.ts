import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for `channel.credentials_encrypted` (M7).
 *
 * AES-256-GCM via Node's built-in `crypto` — no new dependency, same choice
 * as `scrypt` for passwords and `createHmac` for sessions/tokens. GCM is
 * authenticated: a tampered or corrupted ciphertext fails to decrypt rather
 * than silently returning garbage.
 *
 * Envelope on disk is one base64 string: `iv (12 bytes) | authTag (16 bytes)
 * | ciphertext`. No versioning field yet — there is only one scheme; add one
 * if that ever changes.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class CredentialsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsKeyError";
  }
}

export class CredentialsDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsDecryptionError";
  }
}

function key(): Buffer {
  const value = process.env.CHANNEL_CREDENTIALS_KEY;
  if (!value) {
    throw new CredentialsKeyError(
      "CHANNEL_CREDENTIALS_KEY is not set. See .env.example.",
    );
  }
  const buf = /^[0-9a-f]+$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new CredentialsKeyError(
      `CHANNEL_CREDENTIALS_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return buf;
}

/** Encrypt any JSON-serialisable value into one opaque base64 string. */
export function encryptCredentials(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypt an envelope produced by `encryptCredentials`. `null`/`undefined`
 * (no credentials stored) decrypts to `{}`. Throws `CredentialsDecryptionError`
 * for anything malformed, tampered, or encrypted under a different key —
 * never returns partial or garbage data.
 */
export function decryptCredentials<T = Record<string, unknown>>(
  envelope: string | null | undefined,
): T {
  if (!envelope) return {} as T;

  let raw: Buffer;
  try {
    raw = Buffer.from(envelope, "base64");
  } catch {
    throw new CredentialsDecryptionError("Credentials envelope is not valid base64.");
  }
  if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new CredentialsDecryptionError("Credentials envelope is too short.");
  }

  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (cause) {
    throw new CredentialsDecryptionError(
      `Could not decrypt channel credentials: ${(cause as Error).message}`,
    );
  }
}
