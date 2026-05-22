import "server-only";

import type { Permission } from "./permissions";

export interface SessionClaims {
  userId: string;
  workspaceId: string;
  permissions: Permission[];
  jti: string;
  iat: number;
  exp: number;
}

export async function signSessionToken(_claims: Omit<SessionClaims, "jti" | "iat" | "exp">): Promise<string> {
  throw new Error("NOT_IMPLEMENTED: signSessionToken");
}

export async function verifySessionToken(_token: string): Promise<SessionClaims> {
  throw new Error("NOT_IMPLEMENTED: verifySessionToken");
}
