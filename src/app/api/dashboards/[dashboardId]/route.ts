import type { DashboardListMode } from "../../../../contracts";
import {
  deleteWorkspaceDashboard,
  getWorkspaceDashboardSnapshot,
} from "../../../../server/cloud/repository";

function resolveMode(input: string | null): DashboardListMode {
  return input === "viewer" ? "viewer" : "authoring";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ dashboardId: string }> },
): Promise<Response> {
  const { dashboardId } = await context.params;
  const url = new URL(request.url);
  const mode = resolveMode(url.searchParams.get("mode"));
  const workspaceId = url.searchParams.get("workspaceId")?.trim() || "ws_default";

  try {
    const snapshot = await getWorkspaceDashboardSnapshot({
      workspaceId,
      dashboardId,
      mode,
    });
    if (!snapshot) {
      return Response.json(
        {
          status_code: 404,
          reason: "DASHBOARD_NOT_FOUND",
          data: null,
        },
        { status: 404 },
      );
    }

    return Response.json({
      status_code: 200,
      reason: "OK",
      data: snapshot,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_LOAD_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ dashboardId: string }> },
): Promise<Response> {
  const { dashboardId } = await context.params;
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId")?.trim() || "ws_default";

  try {
    await deleteWorkspaceDashboard({ workspaceId, dashboardId });
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        dashboard_id: dashboardId,
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_DELETE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
