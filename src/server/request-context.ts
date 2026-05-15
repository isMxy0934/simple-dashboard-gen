import "server-only";

import type { QueryResultRow } from "pg";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";
import { getPgPool } from "@/server/datasource/postgres";
import { serviceError, serviceOk, type ServiceResult } from "@/server/service-result";

interface WorkspaceRow extends QueryResultRow {
  id: string;
}

interface WorkspaceUserRow extends QueryResultRow {
  user_id: string;
}

interface DashboardWorkspaceRow extends QueryResultRow {
  workspace_id: string;
}

export interface ServerRequestContextInput {
  workspaceId?: unknown;
  userId?: unknown;
  dashboardId?: unknown;
}

export interface ServerRequestContextRequirements {
  requireWorkspace?: boolean;
  requireUser?: boolean;
  requireDashboard?: boolean;
}

export interface ServerRequestContext {
  workspaceId: string;
  userId?: string;
  dashboardId?: string;
}

function trimNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function selectWorkspace(workspaceId: string): Promise<string | null> {
  const pool = getPgPool();
  const result = await pool.query<WorkspaceRow>(
    `
      select id
      from workspaces
      where id = $1
      limit 1
    `,
    [workspaceId],
  );
  return result.rows[0]?.id ?? null;
}

async function selectWorkspaceUser(input: {
  workspaceId: string;
  userId: string;
}): Promise<string | null> {
  const pool = getPgPool();
  const result = await pool.query<WorkspaceUserRow>(
    `
      select user_id
      from workspace_users
      where workspace_id = $1 and user_id = $2
      limit 1
    `,
    [input.workspaceId, input.userId],
  );
  return result.rows[0]?.user_id ?? null;
}

async function selectDashboardWorkspace(
  dashboardId: string,
): Promise<string | null> {
  const pool = getPgPool();
  const result = await pool.query<DashboardWorkspaceRow>(
    `
      select workspace_id
      from workspace_dashboards
      where id = $1
      limit 1
    `,
    [dashboardId],
  );
  return result.rows[0]?.workspace_id ?? null;
}

export async function resolveServerRequestContext(
  input: ServerRequestContextInput,
  requirements: ServerRequestContextRequirements = {},
): Promise<ServiceResult<ServerRequestContext>> {
  const requireWorkspace = requirements.requireWorkspace ?? true;
  const workspaceId = trimNonEmptyString(input.workspaceId);
  const userId = trimNonEmptyString(input.userId);
  const dashboardId = trimNonEmptyString(input.dashboardId);

  if (requireWorkspace && !workspaceId) {
    return serviceError({
      code: "INVALID_REQUEST_CONTEXT",
      status: 400,
      reason: "MISSING_WORKSPACE_ID",
    });
  }
  if (requirements.requireUser && !userId) {
    return serviceError({
      code: "INVALID_REQUEST_CONTEXT",
      status: 400,
      reason: "MISSING_USER_ID",
    });
  }
  if (requirements.requireDashboard && !dashboardId) {
    return serviceError({
      code: "INVALID_REQUEST_CONTEXT",
      status: 400,
      reason: "MISSING_DASHBOARD_ID",
    });
  }

  try {
    await ensureCloudAuthoringSchema();

    let resolvedWorkspaceId = workspaceId;
    if (dashboardId) {
      const dashboardWorkspaceId = await selectDashboardWorkspace(dashboardId);
      if (!dashboardWorkspaceId) {
        return serviceError({
          code: "DASHBOARD_NOT_FOUND",
          status: 404,
        });
      }
      if (resolvedWorkspaceId && resolvedWorkspaceId !== dashboardWorkspaceId) {
        return serviceError({
          code: "DASHBOARD_NOT_FOUND",
          status: 404,
        });
      }
      resolvedWorkspaceId = dashboardWorkspaceId;
    }

    if (!resolvedWorkspaceId) {
      return serviceError({
        code: "INVALID_REQUEST_CONTEXT",
        status: 400,
        reason: "MISSING_WORKSPACE_ID",
      });
    }

    const workspace = await selectWorkspace(resolvedWorkspaceId);
    if (!workspace) {
      return serviceError({
        code: "WORKSPACE_NOT_FOUND",
        status: 404,
      });
    }

    if (userId) {
      const workspaceUser = await selectWorkspaceUser({
        workspaceId: resolvedWorkspaceId,
        userId,
      });
      if (!workspaceUser) {
        return serviceError({
          code: "WORKSPACE_USER_NOT_FOUND",
          status: 403,
        });
      }
    }

    return serviceOk({
      workspaceId: resolvedWorkspaceId,
      ...(userId ? { userId } : {}),
      ...(dashboardId ? { dashboardId } : {}),
    });
  } catch (error) {
    return serviceError({
      code: "REQUEST_CONTEXT_RESOLVE_FAILED",
      status: 503,
      reason:
        error instanceof Error ? error.message : "REQUEST_CONTEXT_RESOLVE_FAILED",
    });
  }
}
