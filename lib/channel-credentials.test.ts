import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  CredentialsDecryptionError,
  CredentialsKeyError,
  decryptCredentials,
  encryptCredentials,
} from "./channel-credentials";

beforeEach(() => {
  process.env.CHANNEL_CREDENTIALS_KEY = randomBytes(32).toString("hex");
});

describe("encryptCredentials / decryptCredentials", () => {
  it("round-trips an object", () => {
    const secret = { channelSecret: "s3cr3t", channelAccessToken: "tok-123" };
    const envelope = encryptCredentials(secret);
    expect(decryptCredentials(envelope)).toEqual(secret);
  });

  it("the envelope never contains the plaintext values", () => {
    const envelope = encryptCredentials({ channelSecret: "findme-if-you-can" });
    expect(envelope).not.toContain("findme-if-you-can");
  });

  it("decrypts null/undefined (no credentials stored) to an empty object", () => {
    expect(decryptCredentials(null)).toEqual({});
    expect(decryptCredentials(undefined)).toEqual({});
  });

  it("rejects an envelope encrypted under a different key", () => {
    const envelope = encryptCredentials({ a: 1 });
    process.env.CHANNEL_CREDENTIALS_KEY = randomBytes(32).toString("hex");
    expect(() => decryptCredentials(envelope)).toThrow(CredentialsDecryptionError);
  });

  it("rejects a tampered envelope (GCM auth tag fails)", () => {
    const envelope = encryptCredentials({ a: 1 });
    const bytes = Buffer.from(envelope, "base64");
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the ciphertext
    const tampered = bytes.toString("base64");
    expect(() => decryptCredentials(tampered)).toThrow(CredentialsDecryptionError);
  });

  it("rejects a too-short envelope", () => {
    expect(() => decryptCredentials("YQ==")).toThrow(CredentialsDecryptionError);
  });

  it("throws a clear error when the key is missing", () => {
    delete process.env.CHANNEL_CREDENTIALS_KEY;
    expect(() => encryptCredentials({ a: 1 })).toThrow(CredentialsKeyError);
  });

  it("throws a clear error when the key is the wrong length", () => {
    process.env.CHANNEL_CREDENTIALS_KEY = "tooshort";
    expect(() => encryptCredentials({ a: 1 })).toThrow(CredentialsKeyError);
  });

  it("accepts a base64-encoded 32-byte key too", () => {
    process.env.CHANNEL_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    const envelope = encryptCredentials({ a: 1 });
    expect(decryptCredentials(envelope)).toEqual({ a: 1 });
  });
});
