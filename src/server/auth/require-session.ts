import "server-only";

import type { Permission } from "./permissions";

export interface UserSession {
  userId: string;
  workspaceId: string;
  permissions: Set<Permission>;
  sessionId: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
}

export async function requireServerSession(_req: Request, _opts?: { skipCsrf?: boolean }): Promise<UserSession> {
  throw new Error("NOT_IMPLEMENTED: requireServerSession");
}
