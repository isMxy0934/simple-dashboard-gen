import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function parseKey(raw: string | undefined): Buffer {
  if (!raw?.trim()) {
    throw new Error("DATASOURCE_ENCRYPTION_KEY is not set.");
  }

  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  const b64 = Buffer.from(trimmed, "base64");
  if (b64.length === KEY_LENGTH) {
    return b64;
  }

  throw new Error("DATASOURCE_ENCRYPTION_KEY must be 32 bytes (hex 64 chars or base64).");
}

export function getDatasourceEncryptionKey(): Buffer {
  return parseKey(process.env.DATASOURCE_ENCRYPTION_KEY);
}

export function encryptSecretPayload(plaintext: string): Buffer {
  const key = getDatasourceEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptSecretPayload(ciphertext: Buffer): string {
  const key = getDatasourceEncryptionKey();
  if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid ciphertext.");
  }
  const iv = ciphertext.subarray(0, IV_LENGTH);
  const tag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
