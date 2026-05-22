import "server-only";

import type { Permission } from "./permissions";
import type { UserSession } from "./require-session";

export interface WorkspacePolicy {
  userId: string;
  workspaceId: string;
  permissions: ReadonlySet<Permission>;
}

export const WorkspacePolicy = {
  derive(session: UserSession): WorkspacePolicy {
    return {
      userId: session.userId,
      workspaceId: session.workspaceId,
      permissions: session.permissions,
    };
  },
};
