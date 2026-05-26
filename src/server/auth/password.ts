import "server-only";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT_VERSION = "v1";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export async function hashLocalPassword(
  password: string,
  salt: string | Buffer = randomBytes(16),
): Promise<string> {
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  const derived = await scrypt(password, saltBuffer, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    "scrypt",
    SCRYPT_VERSION,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    String(SCRYPT_KEY_LENGTH),
    base64Url(saltBuffer),
    base64Url(derived),
  ].join("$");
}

export async function verifyLocalPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, version, rawN, rawR, rawP, rawKeyLength, rawSalt, rawHash] =
    storedHash.split("$");

  if (
    algorithm !== "scrypt" ||
    version !== SCRYPT_VERSION ||
    !rawN ||
    !rawR ||
    !rawP ||
    !rawKeyLength ||
    !rawSalt ||
    !rawHash
  ) {
    return false;
  }

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  const keyLength = Number(rawKeyLength);
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    !Number.isInteger(keyLength) ||
    N <= 0 ||
    r <= 0 ||
    p <= 0 ||
    keyLength <= 0
  ) {
    return false;
  }

  try {
    const expected = decodeBase64Url(rawHash);
    const actual = await scrypt(password, decodeBase64Url(rawSalt), keyLength, {
      N,
      r,
      p,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
