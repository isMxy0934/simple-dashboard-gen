import { validateDashboardDocument } from "../../../../contracts/validation";
import type { CloudSaveDraftRequest } from "../../../../contracts";
import {
  DraftVersionConflictError,
  getWorkspaceDashboardSnapshot,
  saveWorkspaceDashboardDraft,
} from "../../../../server/cloud/repository";

function isCloudSaveDraftRequest(value: unknown): value is CloudSaveDraftRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "workspaceId" in value &&
    "userId" in value &&
    "dashboardId" in value &&
    "sessionId" in value &&
    "baseVersion" in value &&
    "draft" in value
  );
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  if (!isCloudSaveDraftRequest(payload)) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_SAVE_REQUEST",
        data: null,
      },
      { status: 400 },
    );
  }

  const validation = validateDashboardDocument(payload.draft, "save");
  if (!validation.ok) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_DASHBOARD_DOCUMENT",
        data: {
          issues: validation.issues,
        },
      },
      { status: 400 },
    );
  }

  try {
    const existing = await getWorkspaceDashboardSnapshot({
      workspaceId: payload.workspaceId,
      dashboardId: payload.dashboardId,
      mode: "authoring",
    });
    if (!existing) {
      return Response.json(
        {
          status_code: 404,
          reason: "DASHBOARD_NOT_FOUND",
          data: null,
        },
        { status: 404 },
      );
    }

    const saved = await saveWorkspaceDashboardDraft({
      ...payload,
      draft: validation.value,
    });

    return Response.json({
      status_code: 200,
      reason: saved.changed ? "OK" : "NO_CHANGES",
      data: {
        dashboard_id: payload.dashboardId,
        version: saved.version,
        saved_at: saved.saved_at,
        changed: saved.changed,
      },
    });
  } catch (error) {
    if (error instanceof DraftVersionConflictError) {
      return Response.json(
        {
          status_code: 409,
          reason: error.message,
          data: {
            latestVersion: error.latestVersion,
          },
        },
        { status: 409 },
      );
    }

    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
