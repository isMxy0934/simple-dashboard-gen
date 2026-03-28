import {
  validateDashboardDocument,
} from "../../../../contracts/validation";
import {
  getDashboardSnapshot,
  saveDashboardDraft,
} from "../../../../server/dashboards/repository";
import type { SaveRequest } from "../../../../contracts";

function isSaveRequest(value: unknown): value is SaveRequest {
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

  if (!isSaveRequest(payload) || !payload.dashboard_id) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_SAVE_REQUEST",
        data: null,
      },
      { status: 400 },
    );
  }

  const validation = validateDashboardDocument(payload, "save");
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

    const saved = await saveDashboardDraft({
      dashboardId: payload.dashboard_id,
      document: payload,
    });

    return Response.json({
      status_code: 200,
      reason: saved.changed ? "OK" : "NO_CHANGES",
      data: {
        dashboard_id: payload.dashboard_id,
        draft_id: saved.draft_id,
        version: saved.version,
        saved_at: saved.saved_at,
        changed: saved.changed,
      },
    });
  } catch (error) {
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
