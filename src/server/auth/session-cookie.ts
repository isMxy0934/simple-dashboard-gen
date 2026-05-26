import "server-only";

import { SESSION_COOKIE_NAME } from "./require-session";

function secureCookieAttribute(request: Request): string {
  return new URL(request.url).protocol === "https:" ||
    process.env.NODE_ENV === "production"
    ? "; Secure"
    : "";
}

function sessionTtlDays(): number {
  const days = Number(process.env.SDS_SESSION_TTL_DAYS ?? "7");
  return Number.isInteger(days) && days > 0 ? days : 7;
}

export function createSessionCookie(request: Request, token: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${sessionTtlDays() * 24 * 60 * 60}`,
    secureCookieAttribute(request),
  ]
    .filter(Boolean)
    .join("; ");
}

export function createExpiredSessionCookie(request: Request): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secureCookieAttribute(request),
  ]
    .filter(Boolean)
    .join("; ");
}
