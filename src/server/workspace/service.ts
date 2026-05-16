import "server-only";

import type {
  EditingPresenceEntry,
  WorkspaceUserLocale,
  WorkspaceContextPayload,
  WorkspaceUserSettings,
} from "@/contracts";
import { listEditingPresence } from "@/server/cloud/editing-session-repository";
import {
  getWorkspaceContext,
  getWorkspaceUserSettings,
  updateWorkspaceUserSettings,
} from "@/server/cloud/workspace-repository";
import { serviceError, serviceOk, type ServiceResult } from "@/server/service-result";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWorkspaceRequest(value: unknown): value is { workspaceId: string } {
  return isRecord(value) && isNonEmptyString(value.workspaceId);
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
  if (!isWorkspaceRequest(payload)) {
    return serviceError({
      code: "INVALID_WORKSPACE_CONTEXT_REQUEST",
      status: 400,
    });
  }

  try {
    const context = await getWorkspaceContext(payload.workspaceId.trim());
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
