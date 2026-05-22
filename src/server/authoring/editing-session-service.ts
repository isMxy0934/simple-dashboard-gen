import "server-only";

import type {
  AuthoringSessionPayload,
  OpenSessionRequest,
  OpenSessionResponse,
  SaveSessionRequest,
} from "@/contracts";
import {
  EditingSessionRevisionConflictError,
  openEditingSession,
  saveEditingSession,
} from "@/server/cloud/editing-session-repository";
import { serviceError, serviceOk, type ServiceResult } from "@/server/service-result";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmed(value: string): string {
  return value.trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOpenSessionRequest(value: unknown): value is OpenSessionRequest {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.dashboardId) &&
    isNonEmptyString(value.editingSessionId) &&
    !("sessionId" in value)
  );
}

function isSaveSessionRequest(value: unknown): value is SaveSessionRequest {
  return (
    isRecord(value) &&
    isRecord(value.payload) &&
    isNonEmptyString(value.payload.workspaceId) &&
    isNonEmptyString(value.payload.userId) &&
    isNonEmptyString(value.payload.dashboardId) &&
    isNonEmptyString(value.payload.editingSessionId) &&
    !("sessionId" in value.payload) &&
    typeof value.expectedSessionRevision === "number" &&
    Number.isInteger(value.expectedSessionRevision) &&
    value.expectedSessionRevision >= 0 &&
    isNonEmptyString(value.expectedDocumentHash)
  );
}

export async function openEditingSessionService(
  payload: unknown,
): Promise<ServiceResult<OpenSessionResponse>> {
  if (!isOpenSessionRequest(payload)) {
    return serviceError({
      code: "INVALID_OPEN_SESSION_REQUEST",
      status: 400,
    });
  }

  try {
    return serviceOk(await openEditingSession({
      ...payload,
      workspaceId: trimmed(payload.workspaceId),
      userId: trimmed(payload.userId),
      dashboardId: trimmed(payload.dashboardId),
      editingSessionId: trimmed(payload.editingSessionId),
    }));
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "AUTHORING_SESSION_OPEN_FAILED";
    return serviceError({
      code: reason,
      status: reason === "DASHBOARD_NOT_FOUND" ? 404 : 503,
      reason,
    });
  }
}

export async function saveEditingSessionService(
  payload: unknown,
): Promise<ServiceResult<AuthoringSessionPayload>> {
  if (!isSaveSessionRequest(payload)) {
    return serviceError({
      code: "INVALID_SAVE_SESSION_REQUEST",
      status: 400,
    });
  }

  try {
    return serviceOk(await saveEditingSession({
      ...payload,
      payload: {
        ...payload.payload,
        workspaceId: trimmed(payload.payload.workspaceId),
        userId: trimmed(payload.payload.userId),
        dashboardId: trimmed(payload.payload.dashboardId),
        editingSessionId: trimmed(payload.payload.editingSessionId),
      },
    }));
  } catch (error) {
    if (error instanceof EditingSessionRevisionConflictError) {
      return serviceError({
        code: "AUTHORING_SESSION_REVISION_CONFLICT",
        status: 409,
        reason: error.message,
        details: {
          latestRevision: error.latestRevision,
        },
      });
    }

    return serviceError({
      code: "AUTHORING_SESSION_SAVE_FAILED",
      status: 503,
      reason:
        error instanceof Error ? error.message : "AUTHORING_SESSION_SAVE_FAILED",
    });
  }
}
