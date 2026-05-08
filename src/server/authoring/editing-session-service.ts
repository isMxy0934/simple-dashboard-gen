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

function isOpenSessionRequest(value: unknown): value is OpenSessionRequest {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    typeof value.userId === "string" &&
    typeof value.dashboardId === "string" &&
    typeof value.sessionId === "string"
  );
}

function isSaveSessionRequest(value: unknown): value is SaveSessionRequest {
  return (
    isRecord(value) &&
    isRecord(value.payload) &&
    typeof value.payload.workspaceId === "string" &&
    typeof value.payload.userId === "string" &&
    typeof value.payload.dashboardId === "string" &&
    typeof value.payload.sessionId === "string" &&
    typeof value.expectedSessionRevision === "number" &&
    Number.isInteger(value.expectedSessionRevision) &&
    value.expectedSessionRevision >= 0 &&
    typeof value.expectedDocumentHash === "string" &&
    value.expectedDocumentHash.trim().length > 0
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
    return serviceOk(await openEditingSession(payload));
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
    return serviceOk(await saveEditingSession(payload));
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
