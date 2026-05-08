import "server-only";

import type { QueryResultRow } from "pg";
import type {
  WorkspaceContextPayload,
  WorkspaceUserSettings,
} from "@/contracts";
import { getPgPool } from "@/server/datasource/postgres";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
}

interface WorkspaceUserRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  name: string;
  email: string | null;
}

interface WorkspaceUserSettingsRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  verbose: boolean;
  updated_at: string | Date;
}

function nowIso(value?: string | Date | null) {
  return new Date(value ?? new Date()).toISOString();
}

async function selectWorkspaceUserSettings(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceUserSettings | null> {
  const pool = getPgPool();
  const result = await pool.query<WorkspaceUserSettingsRow>(
    `
      select workspace_id, user_id, verbose_enabled as verbose, updated_at
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
    updated_at: nowIso(row.updated_at),
  };
}

export async function getWorkspaceContext(
  workspaceId: string,
): Promise<WorkspaceContextPayload | null> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
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

  const usersResult = await pool.query<WorkspaceUserRow>(
    `
      select workspace_id, user_id, name, email
      from workspace_users
      where workspace_id = $1
      order by name asc
    `,
    [workspaceId],
  );
  return {
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    users: usersResult.rows.map((row) => ({
      workspace_id: row.workspace_id,
      user_id: row.user_id,
      name: row.name,
      email: row.email ?? undefined,
    })),
  };
}

export async function getWorkspaceUserSettings(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceUserSettings | null> {
  await ensureCloudAuthoringSchema();
  return selectWorkspaceUserSettings(input.workspaceId, input.userId);
}

export async function updateWorkspaceUserVerboseSetting(input: {
  workspaceId: string;
  userId: string;
  verbose: boolean;
}): Promise<WorkspaceUserSettings> {
  await ensureCloudAuthoringSchema();
  const pool = getPgPool();
  const result = await pool.query<WorkspaceUserSettingsRow>(
    `
      insert into workspace_user_settings (workspace_id, user_id, verbose_enabled)
      values ($1, $2, $3)
      on conflict (workspace_id, user_id)
      do update set verbose_enabled = excluded.verbose_enabled, updated_at = now()
      returning workspace_id, user_id, verbose_enabled as verbose, updated_at
    `,
    [input.workspaceId, input.userId, input.verbose],
  );

  const row = result.rows[0];
  return {
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    verbose: row.verbose,
    updated_at: nowIso(row.updated_at),
  };
}
