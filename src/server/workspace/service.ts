import "server-only";

import type {
  EditingPresenceEntry,
  WorkspaceUserLocale,
  WorkspaceContextPayload,
  WorkspaceRoleId,
  WorkspaceUserRoleUpdateResponse,
  WorkspaceUserSettings,
} from "@/contracts";
import { listEditingPresence } from "@/server/cloud/editing-session-repository";
import {
  WORKSPACE_ROLE_IDS,
  getWorkspaceContext,
  getWorkspaceUserSettings,
  updateWorkspaceUserRole,
  updateWorkspaceUserSettings,
  WorkspaceRoleUpdateError,
} from "@/server/cloud/workspace-repository";
import { serviceError, serviceOk, type ServiceResult } from "@/server/service-result";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWorkspaceContextRequest(value: unknown): value is {
  workspaceId: string;
  currentUserId: string;
  currentUserPermissions?: string[];
} {
  return isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.currentUserId) &&
    (value.currentUserPermissions === undefined ||
      (Array.isArray(value.currentUserPermissions) &&
        value.currentUserPermissions.every((permission) => typeof permission === "string")));
}

function isWorkspaceUserRequest(value: unknown): value is {
  workspaceId: string;
  userId: string;
} {
  return isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.userId);
}

function isWorkspaceUserSettingsUpdateRequest(value: unknown): value is {
  workspaceId: string;
  userId: string;
  verbose?: boolean;
  locale?: WorkspaceUserLocale;
} {
  if (!isRecord(value) ||
    !isNonEmptyString(value.workspaceId) ||
    !isNonEmptyString(value.userId)) {
    return false;
  }
  const hasVerbose = typeof value.verbose === "boolean";
  const hasLocale = value.locale === "zh" || value.locale === "en";
  return hasVerbose || hasLocale;
}

function isWorkspaceRoleId(value: unknown): value is WorkspaceRoleId {
  return typeof value === "string" &&
    WORKSPACE_ROLE_IDS.includes(value as WorkspaceRoleId);
}

function isWorkspaceUserRoleUpdateRequest(value: unknown): value is {
  workspaceId: string;
  userId: string;
  roleId: WorkspaceRoleId;
} {
  return isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.userId) &&
    isWorkspaceRoleId(value.roleId);
}

function isPresenceRequest(value: unknown): value is {
  workspaceId: string;
  dashboardId: string;
} {
  return isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.dashboardId);
}

export async function getWorkspaceContextService(
  payload: unknown,
): Promise<ServiceResult<WorkspaceContextPayload>> {
  if (!isWorkspaceContextRequest(payload)) {
    return serviceError({
      code: "INVALID_WORKSPACE_CONTEXT_REQUEST",
      status: 400,
    });
  }

  try {
    const context = await getWorkspaceContext(payload.workspaceId.trim(), {
      currentUserId: payload.currentUserId.trim(),
      currentUserPermissions: payload.currentUserPermissions ?? [],
    });
    if (!context) {
      return serviceError({
        code: "WORKSPACE_NOT_FOUND",
        status: 404,
      });
    }
    return serviceOk(context);
  } catch (error) {
    return serviceError({
      code: "WORKSPACE_CONTEXT_FAILED",
      status: 503,
      reason: error instanceof Error ? error.message : "WORKSPACE_CONTEXT_FAILED",
    });
  }
}

export async function updateWorkspaceUserRoleService(
  payload: unknown,
): Promise<ServiceResult<WorkspaceUserRoleUpdateResponse>> {
  if (!isWorkspaceUserRoleUpdateRequest(payload)) {
    return serviceError({
      code: "INVALID_WORKSPACE_ROLE_REQUEST",
      status: 400,
    });
  }

  try {
    return serviceOk(await updateWorkspaceUserRole({
      workspaceId: payload.workspaceId.trim(),
      userId: payload.userId.trim(),
      roleId: payload.roleId,
    }));
  } catch (error) {
    if (error instanceof WorkspaceRoleUpdateError) {
      return serviceError({
        code: error.code,
        status: error.status,
      });
    }
    return serviceError({
      code: "WORKSPACE_ROLE_UPDATE_FAILED",
      status: 503,
      reason:
        error instanceof Error ? error.message : "WORKSPACE_ROLE_UPDATE_FAILED",
    });
  }
}

export async function getWorkspaceUserSettingsService(
  payload: unknown,
): Promise<ServiceResult<WorkspaceUserSettings>> {
  if (!isWorkspaceUserRequest(payload)) {
    return serviceError({
      code: "INVALID_WORKSPACE_SETTINGS_REQUEST",
      status: 400,
    });
  }

  try {
    const settings = await getWorkspaceUserSettings({
      workspaceId: payload.workspaceId.trim(),
      userId: payload.userId.trim(),
    });
    if (!settings) {
      return serviceError({
        code: "WORKSPACE_USER_SETTINGS_NOT_FOUND",
        status: 404,
      });
    }
    return serviceOk(settings);
  } catch (error) {
    return serviceError({
      code: "AUTHORING_SETTINGS_LOAD_FAILED",
      status: 503,
      reason:
        error instanceof Error ? error.message : "AUTHORING_SETTINGS_LOAD_FAILED",
    });
  }
}

export async function updateWorkspaceUserSettingsService(
  payload: unknown,
): Promise<ServiceResult<WorkspaceUserSettings>> {
  if (!isWorkspaceUserSettingsUpdateRequest(payload)) {
    return serviceError({
      code: "INVALID_SETTINGS_REQUEST",
      status: 400,
    });
  }

  try {
    const verbose = typeof payload.verbose === "boolean" ? payload.verbose : undefined;
    const locale =
      payload.locale === "zh" || payload.locale === "en" ? payload.locale : undefined;

    return serviceOk(await updateWorkspaceUserSettings({
      workspaceId: payload.workspaceId.trim(),
      userId: payload.userId.trim(),
      verbose,
      locale,
    }));
  } catch (error) {
    return serviceError({
      code: "AUTHORING_SETTINGS_SAVE_FAILED",
      status: 503,
      reason:
        error instanceof Error ? error.message : "AUTHORING_SETTINGS_SAVE_FAILED",
    });
  }
}

export async function listEditingPresenceService(
  payload: unknown,
): Promise<ServiceResult<{ presence: EditingPresenceEntry[] }>> {
  if (!isPresenceRequest(payload)) {
    return serviceError({
      code: "INVALID_WORKSPACE_PRESENCE_REQUEST",
      status: 400,
    });
  }

  try {
    return serviceOk({
      presence: await listEditingPresence({
        workspaceId: payload.workspaceId.trim(),
        dashboardId: payload.dashboardId.trim(),
      }),
    });
  } catch (error) {
    return serviceError({
      code: "WORKSPACE_PRESENCE_FAILED",
      status: 503,
      reason:
        error instanceof Error ? error.message : "WORKSPACE_PRESENCE_FAILED",
    });
  }
}
