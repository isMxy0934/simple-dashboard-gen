import type { CloudPublishRequest } from "../../../../contracts";
import {
  PublishVersionConflictError,
  getWorkspaceDashboardSnapshot,
  publishWorkspaceDashboard,
} from "../../../../server/cloud/repository";

function isCloudPublishRequest(value: unknown): value is CloudPublishRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "workspaceId" in value &&
    "userId" in value &&
    "dashboardId" in value &&
    "draftVersion" in value
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

  if (!isCloudPublishRequest(payload)) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PUBLISH_REQUEST",
        data: null,
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

    const published = await publishWorkspaceDashboard(payload);

    return Response.json({
      status_code: 200,
      reason: published.changed ? "OK" : "NO_CHANGES",
      data: {
        dashboard_id: payload.dashboardId,
        version: published.version,
        published_at: published.published_at,
        changed: published.changed,
      },
    });
  } catch (error) {
    if (error instanceof PublishVersionConflictError) {
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
        reason: error instanceof Error ? error.message : "DASHBOARD_PUBLISH_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
