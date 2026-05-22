import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { Permission } from "./permissions";
import { Permission as PermissionValue } from "./permissions";
import { ApiError } from "@/server/api-error";

export interface SessionClaims {
  userId: string;
  workspaceId: string;
  permissions: Permission[];
  jti: string;
  iat: number;
  exp: number;
}

export interface VerifySessionTokenOptions {
  allowExpiredWithinGraceSeconds?: number;
}

interface SessionSecret {
  kid: string;
  secret: string;
}

interface SessionSecrets {
  current: SessionSecret;
  previous: SessionSecret[];
}

const DEFAULT_SESSION_TTL_DAYS = 7;
const MIN_SECRET_LENGTH = 32;
const PERMISSIONS = new Set<string>(Object.values(PermissionValue));

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlJson(input: unknown): string {
  return base64UrlEncode(JSON.stringify(input));
}

function decodeBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }
}

function authConfigError(reason: string): ApiError {
  return new ApiError(500, "AUTH_CONFIG_ERROR", "error.auth.config", { reason });
}

function parseSessionSecrets(raw: string | undefined): SessionSecrets {
  if (!raw) {
    throw authConfigError("SDS_SESSION_SECRETS is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw authConfigError("SDS_SESSION_SECRETS must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw authConfigError("SDS_SESSION_SECRETS must be an object.");
  }

  const candidate = parsed as {
    current?: unknown;
    previous?: unknown;
  };
  const current = parseSessionSecret(candidate.current, "current");
  const previous = Array.isArray(candidate.previous)
    ? candidate.previous.map((entry, index) =>
        parseSessionSecret(entry, `previous[${index}]`),
      )
    : [];

  return { current, previous };
}

function parseSessionSecret(input: unknown, label: string): SessionSecret {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw authConfigError(`SDS_SESSION_SECRETS.${label} must be an object.`);
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.kid !== "string" || !candidate.kid.trim()) {
    throw authConfigError(`SDS_SESSION_SECRETS.${label}.kid is required.`);
  }
  if (
    typeof candidate.secret !== "string" ||
    candidate.secret.length < MIN_SECRET_LENGTH
  ) {
    throw authConfigError(
      `SDS_SESSION_SECRETS.${label}.secret must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  return {
    kid: candidate.kid.trim(),
    secret: candidate.secret,
  };
}

function loadSessionSecrets(): SessionSecrets {
  if (!process.env.SDS_SESSION_SECRETS && process.env.NODE_ENV !== "production") {
    return {
      current: {
        kid: "dev",
        secret: "dev-only-session-secret-32-bytes-minimum",
      },
      previous: [],
    };
  }
  return parseSessionSecrets(process.env.SDS_SESSION_SECRETS);
}

function sessionTtlSeconds(): number {
  const raw = process.env.SDS_SESSION_TTL_DAYS;
  const days = raw === undefined ? DEFAULT_SESSION_TTL_DAYS : Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw authConfigError("SDS_SESSION_TTL_DAYS must be a positive integer.");
  }
  return days * 24 * 60 * 60;
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function findSecretByKid(kid: unknown, secrets: SessionSecrets): SessionSecret | null {
  if (typeof kid !== "string" || !kid.trim()) {
    return null;
  }
  return [secrets.current, ...secrets.previous].find((secret) => secret.kid === kid) ?? null;
}

function validateClaims(
  input: unknown,
  options: VerifySessionTokenOptions = {},
): SessionClaims {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }
  const claims = input as Record<string, unknown>;
  const permissions = claims.permissions;
  if (
    typeof claims.userId !== "string" ||
    !claims.userId.trim() ||
    typeof claims.workspaceId !== "string" ||
    !claims.workspaceId.trim() ||
    typeof claims.jti !== "string" ||
    !claims.jti.trim() ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    !Array.isArray(permissions) ||
    !permissions.every((permission) => typeof permission === "string" && PERMISSIONS.has(permission))
  ) {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }

  const now = Math.floor(Date.now() / 1000);
  if ((claims.exp as number) <= now) {
    const graceSeconds = options.allowExpiredWithinGraceSeconds ?? 0;
    const expiredSeconds = now - (claims.exp as number);
    if (expiredSeconds > graceSeconds) {
      throw new ApiError(401, "SESSION_EXPIRED", "error.auth.session_expired");
    }
  }

  return {
    userId: claims.userId.trim(),
    workspaceId: claims.workspaceId.trim(),
    permissions: permissions as Permission[],
    jti: claims.jti.trim(),
    iat: claims.iat as number,
    exp: claims.exp as number,
  };
}

export async function signSessionToken(
  claims: Omit<SessionClaims, "jti" | "iat" | "exp">,
): Promise<string> {
  const secrets = loadSessionSecrets();
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = {
    userId: claims.userId.trim(),
    workspaceId: claims.workspaceId.trim(),
    permissions: claims.permissions,
    jti: randomUUID(),
    iat: now,
    exp: now + sessionTtlSeconds(),
  };
  validateClaims(payload);

  const header = base64UrlJson({
    alg: "HS256",
    typ: "JWT",
    kid: secrets.current.kid,
  });
  const body = base64UrlJson(payload);
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${sign(signingInput, secrets.current.secret)}`;
}

export async function verifySessionToken(
  token: string,
  options: VerifySessionTokenOptions = {},
): Promise<SessionClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = decodeBase64UrlJson(encodedHeader);
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }

  const headerRecord = header as Record<string, unknown>;
  if (headerRecord.alg !== "HS256" || headerRecord.typ !== "JWT") {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }

  const secret = findSecretByKid(headerRecord.kid, loadSessionSecrets());
  if (!secret) {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  if (!secureEqual(signature, sign(signingInput, secret.secret))) {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }

  return validateClaims(decodeBase64UrlJson(encodedPayload), options);
}
