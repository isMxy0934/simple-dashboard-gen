import "server-only";

import type { QueryResultRow } from "pg";
import type {
  WorkspaceContextPayload,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceRoleId,
  WorkspaceUserRoleUpdateResponse,
  WorkspaceUserLocale,
  WorkspaceUserSettings,
} from "@/contracts";
import { getPgPool } from "@/server/datasource/postgres";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";

export const WORKSPACE_ROLE_IDS = ["viewer", "editor", "admin"] as const;

export interface QueryablePool {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  connect?: () => Promise<{
    query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }>;
    release(): void;
  }>;
}

export class WorkspaceRoleUpdateError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "WorkspaceRoleUpdateError";
    this.status = status;
    this.code = code;
  }
}

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
}

interface WorkspaceUserRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  name: string;
  email: string | null;
  role_id: string | null;
  role_name: string | null;
}

interface WorkspaceRoleRow extends QueryResultRow {
  role_id: string;
  name: string;
  permissions: string[] | null;
}

interface WorkspaceUserSettingsRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  verbose: boolean;
  locale: string;
  updated_at: string | Date;
}

function isWorkspaceRoleId(value: unknown): value is WorkspaceRoleId {
  return typeof value === "string" &&
    WORKSPACE_ROLE_IDS.includes(value as WorkspaceRoleId);
}

function roleSortValue(roleId: string): number {
  return roleId === "viewer" ? 1 : roleId === "editor" ? 2 : roleId === "admin" ? 3 : 4;
}

function resolvePool(options?: { pool?: QueryablePool }): QueryablePool {
  return options?.pool ?? getPgPool();
}

async function ensureWorkspaceStoreReady(options?: {
  pool?: QueryablePool;
}): Promise<void> {
  if (!options?.pool) {
    await ensureCloudAuthoringSchema();
  }
}

function nowIso(value?: string | Date | null) {
  return new Date(value ?? new Date()).toISOString();
}

function normalizeLocale(value: string | null | undefined): WorkspaceUserLocale {
  return value === "en" ? "en" : "zh";
}

async function selectWorkspaceUserSettings(
  workspaceId: string,
  userId: string,
  options?: { pool?: QueryablePool },
): Promise<WorkspaceUserSettings | null> {
  const pool = resolvePool(options);
  const result = await pool.query<WorkspaceUserSettingsRow>(
    `
      select workspace_id, user_id, verbose_enabled as verbose, locale, updated_at
      from workspace_user_settings
      where workspace_id = $1 and user_id = $2
      limit 1
    `,
    [workspaceId, userId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    verbose: row.verbose,
    locale: normalizeLocale(row.locale),
    updated_at: nowIso(row.updated_at),
  };
}

export async function getWorkspaceContext(
  workspaceId: string,
  options: {
    currentUserId?: string;
    currentUserPermissions?: string[];
    pool?: QueryablePool;
  } = {},
): Promise<WorkspaceContextPayload | null> {
  await ensureWorkspaceStoreReady(options);
  const pool = resolvePool(options);
  const workspaceResult = await pool.query<WorkspaceRow>(
    `
      select id, name
      from workspaces
      where id = $1
      limit 1
    `,
    [workspaceId],
  );
  const workspace = workspaceResult.rows[0];
  if (!workspace) {
    return null;
  }

  const rolesResult = await pool.query<WorkspaceRoleRow>(
    `
      select
        r.role_id,
        r.name,
        coalesce(
          array_agg(rp.permission order by rp.permission)
            filter (where rp.permission is not null),
          '{}'
        ) as permissions
      from workspace_roles r
      left join workspace_role_permissions rp
        on rp.workspace_id = r.workspace_id
       and rp.role_id = r.role_id
      where r.workspace_id = $1
      group by r.role_id, r.name
      order by case r.role_id
        when 'viewer' then 1
        when 'editor' then 2
        when 'admin' then 3
        else 4
      end
    `,
    [workspaceId],
  );
  const roles: WorkspaceRole[] = rolesResult.rows
    .filter(
      (row): row is WorkspaceRoleRow & { role_id: WorkspaceRoleId } =>
        isWorkspaceRoleId(row.role_id),
    )
    .map((row) => ({
      role_id: row.role_id,
      name: row.name,
      permissions: row.permissions ?? [],
    }));

  const usersResult = await pool.query<WorkspaceUserRow>(
    `
      select
        u.workspace_id,
        u.user_id,
        u.name,
        u.email,
        role.role_id,
        wr.name as role_name
      from workspace_users
      u
      left join lateral (
        select role_id
        from workspace_user_roles
        where workspace_id = u.workspace_id
          and user_id = u.user_id
        order by case role_id
          when 'admin' then 1
          when 'editor' then 2
          when 'viewer' then 3
          else 4
        end
        limit 1
      ) role on true
      left join workspace_roles wr
        on wr.workspace_id = u.workspace_id
       and wr.role_id = role.role_id
      where u.workspace_id = $1
      order by u.name asc
    `,
    [workspaceId],
  );
  return {
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    current_user_id: options.currentUserId ?? "",
    current_user_permissions: options.currentUserPermissions ?? [],
    users: usersResult.rows.map((row) => ({
      workspace_id: row.workspace_id,
      user_id: row.user_id,
      name: row.name,
      email: row.email ?? undefined,
      role_id: isWorkspaceRoleId(row.role_id) ? row.role_id : "viewer",
      role_name: row.role_name ?? "Viewer",
    })),
    roles,
  };
}

export async function getWorkspaceUserSettings(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceUserSettings | null> {
  await ensureCloudAuthoringSchema();
  return selectWorkspaceUserSettings(input.workspaceId, input.userId);
}

export async function updateWorkspaceUserSettings(input: {
  workspaceId: string;
  userId: string;
  verbose?: boolean;
  locale?: WorkspaceUserLocale;
}): Promise<WorkspaceUserSettings> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<WorkspaceUserSettingsRow>(
    `
      insert into workspace_user_settings (workspace_id, user_id, verbose_enabled, locale)
      values ($1, $2, coalesce($3, false), coalesce($4, 'zh'))
      on conflict (workspace_id, user_id)
      do update set
        verbose_enabled = coalesce($3, workspace_user_settings.verbose_enabled),
        locale = coalesce($4, workspace_user_settings.locale),
        updated_at = now()
      returning workspace_id, user_id, verbose_enabled as verbose, locale, updated_at
    `,
    [input.workspaceId, input.userId, input.verbose ?? null, input.locale ?? null],
  );

  const row = result.rows[0];
  return {
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    verbose: row.verbose,
    locale: normalizeLocale(row.locale),
    updated_at: nowIso(row.updated_at),
  };
}

export async function updateWorkspaceUserRole(
  input: {
    workspaceId: string;
    userId: string;
    roleId: WorkspaceRoleId;
  },
  options: {
    pool?: QueryablePool;
    revokeUserSessions?: (input: {
      workspaceId: string;
      userId: string;
    }) => Promise<void>;
  } = {},
): Promise<WorkspaceUserRoleUpdateResponse> {
  await ensureWorkspaceStoreReady(options);
  const pool = resolvePool(options);
  const client = pool.connect ? await pool.connect() : pool;

  await client.query("BEGIN");
  try {
    const userResult = await client.query<WorkspaceUserRow>(
      `
        select workspace_id, user_id, name, email
        from workspace_users
        where workspace_id = $1
          and user_id = $2
        for update
      `,
      [input.workspaceId, input.userId],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new WorkspaceRoleUpdateError(404, "WORKSPACE_USER_NOT_FOUND");
    }

    const roleResult = await client.query<WorkspaceRoleRow>(
      `
        select role_id, name
        from workspace_roles
        where workspace_id = $1
          and role_id = $2
        limit 1
      `,
      [input.workspaceId, input.roleId],
    );
    const role = roleResult.rows[0];
    if (!role || !isWorkspaceRoleId(role.role_id)) {
      throw new WorkspaceRoleUpdateError(400, "INVALID_WORKSPACE_ROLE");
    }

    const currentRolesResult = await client.query<{ role_id: string }>(
      `
        select role_id
        from workspace_user_roles
        where workspace_id = $1
          and user_id = $2
      `,
      [input.workspaceId, input.userId],
    );
    const currentRoleIds = currentRolesResult.rows.map((row) => row.role_id);
    if (currentRoleIds.includes("admin") && input.roleId !== "admin") {
      const adminCountResult = await client.query<{ admin_count: string | number }>(
        `
          select count(distinct user_id) as admin_count
          from workspace_user_roles
          where workspace_id = $1
            and role_id = 'admin'
        `,
        [input.workspaceId],
      );
      const adminCount = Number(adminCountResult.rows[0]?.admin_count ?? 0);
      if (adminCount <= 1) {
        throw new WorkspaceRoleUpdateError(409, "LAST_ADMIN_ROLE_REQUIRED");
      }
    }

    await client.query(
      `
        delete from workspace_user_roles
        where workspace_id = $1
          and user_id = $2
      `,
      [input.workspaceId, input.userId],
    );
    await client.query(
      `
        insert into workspace_user_roles (workspace_id, user_id, role_id)
        values ($1, $2, $3)
      `,
      [input.workspaceId, input.userId, input.roleId],
    );

    await client.query("COMMIT");
    await options.revokeUserSessions?.({
      workspaceId: input.workspaceId,
      userId: input.userId,
    });

    const updatedUser: WorkspaceMember = {
      workspace_id: user.workspace_id,
      user_id: user.user_id,
      name: user.name,
      email: user.email ?? undefined,
      role_id: input.roleId,
      role_name: role.name,
    };

    return {
      user: updatedUser,
      requires_relogin: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if ("release" in client) {
      client.release();
    }
  }
}
