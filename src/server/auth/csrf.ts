import "server-only";

import { ApiError } from "@/server/api-error";

export const CSRF_COOKIE_NAME = "sds_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseCookieHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();
    if (!name) {
      continue;
    }
    cookies.set(name, decodeURIComponent(rawValue.join("=").trim()));
  }
  return cookies;
}

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.SDS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

function requestOrigin(req: Request): string {
  try {
    return new URL(req.url).origin;
  } catch {
    throw new ApiError(400, "INVALID_REQUEST_URL", "error.request.invalid_url");
  }
}

function assertOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) {
    throw new ApiError(403, "CSRF_ORIGIN_REQUIRED", "error.auth.csrf_origin_required");
  }

  const ownOrigin = requestOrigin(req);
  if (origin === ownOrigin || allowedOrigins().has(origin)) {
    return;
  }

  throw new ApiError(403, "CSRF_ORIGIN_DENIED", "error.auth.csrf_origin_denied", {
    origin,
  });
}

function assertDoubleSubmitToken(req: Request): void {
  const cookies = parseCookieHeader(req.headers.get("cookie"));
  const cookieToken = cookies.get(CSRF_COOKIE_NAME);
  const headerToken = req.headers.get(CSRF_HEADER_NAME);

  if (!cookieToken && !headerToken) {
    return;
  }

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new ApiError(403, "CSRF_TOKEN_MISMATCH", "error.auth.csrf_token_mismatch");
  }
}

export function assertCsrf(req: Request): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return;
  }

  assertOrigin(req);
  assertDoubleSubmitToken(req);
}
