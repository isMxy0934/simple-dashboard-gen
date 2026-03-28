import { validateDashboardDocument } from "../../../../contracts/validation";
import {
  getDashboardSnapshot,
  publishDashboard,
} from "../../../../server/dashboards/repository";
import type { PublishRequest } from "../../../../contracts";

function isPublishRequest(value: unknown): value is PublishRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "dashboard_spec" in value &&
    "query_defs" in value &&
    "bindings" in value
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

  if (!isPublishRequest(payload) || !payload.dashboard_id) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PUBLISH_REQUEST",
        data: null,
      },
      { status: 400 },
    );
  }

  const validation = validateDashboardDocument(payload, "publish");
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
    const existing = await getDashboardSnapshot(payload.dashboard_id, "authoring");
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

    const published = await publishDashboard({
      dashboardId: payload.dashboard_id,
      document: payload,
    });

    return Response.json({
      status_code: 200,
      reason: published.changed ? "OK" : "NO_CHANGES",
      data: {
        dashboard_id: payload.dashboard_id,
        published_id: published.published_id,
        version: published.version,
        published_at: published.published_at,
        changed: published.changed,
      },
    });
  } catch (error) {
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
