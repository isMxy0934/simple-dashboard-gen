import "server-only";

import { ApiError } from "@/server/api-error";
import {
  Permission as SharedPermission,
  type Permission as SharedPermissionValue,
} from "@/contracts/permissions";

export const Permission = SharedPermission;
export type Permission = SharedPermissionValue;

export function requirePermission(permissions: ReadonlySet<Permission>, permission: Permission): void {
  if (!permissions.has(permission)) {
    throw new ApiError(403, "PERMISSION_DENIED", "error.auth.permission_denied", { permission });
  }
}
