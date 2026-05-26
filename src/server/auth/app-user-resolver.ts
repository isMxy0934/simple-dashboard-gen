import "server-only";

import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";
import { getPgPool } from "@/server/datasource/postgres";
import type { NormalizedIdentity, ResolvedAppUser } from "./identity";
import { Permission } from "./permissions";

export interface QueryablePool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const PERMISSIONS = new Set<string>(Object.values(Permission));

function resolvePool(options?: { pool?: QueryablePool }): QueryablePool {
  return options?.pool ?? getPgPool();
}

async function ensureIdentityStoreReady(options?: {
  pool?: QueryablePool;
}): Promise<void> {
  if (!options?.pool) {
    await ensureCloudAuthoringSchema();
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSIONS.has(value);
}

export async function resolveAppUserForIdentity(
  identity: NormalizedIdentity,
  options: { pool?: QueryablePool } = {},
): Promise<ResolvedAppUser | null> {
  await ensureIdentityStoreReady(options);
  const pool = resolvePool(options);

  const userResult = await pool.query(
    `
      select
        workspace_id,
        user_id,
        email,
        display_name
      from auth_identities
      where provider = $1
        and subject = $2
      limit 1
    `,
    [identity.provider, identity.subject],
  );

  const user = userResult.rows[0];
  if (
    !user ||
    typeof user.workspace_id !== "string" ||
    typeof user.user_id !== "string"
  ) {
    return null;
  }

  const permissionResult = await pool.query(
    `
      select distinct rp.permission
      from workspace_user_roles ur
      join workspace_role_permissions rp
        on rp.workspace_id = ur.workspace_id
       and rp.role_id = ur.role_id
      where ur.workspace_id = $1
        and ur.user_id = $2
      order by rp.permission
    `,
    [user.workspace_id, user.user_id],
  );

  return {
    workspaceId: user.workspace_id,
    userId: user.user_id,
    email: optionalString(user.email) ?? identity.email,
    displayName: optionalString(user.display_name) ?? identity.displayName,
    permissions: permissionResult.rows
      .map((row) => row.permission)
      .filter(isPermission),
  };
}
