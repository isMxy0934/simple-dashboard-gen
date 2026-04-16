import type { DashboardListMode } from "../../../contracts";
import {
  createWorkspaceDashboard,
  listWorkspaceDashboards,
} from "../../../server/cloud/repository";

function resolveMode(input: string | null): DashboardListMode {
  return input === "viewer" ? "viewer" : "authoring";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = resolveMode(url.searchParams.get("mode"));
  const workspaceId = url.searchParams.get("workspaceId")?.trim() || "ws_default";

  try {
    const dashboards = await listWorkspaceDashboards(workspaceId, mode);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        dashboards,
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_LIST_UNAVAILABLE",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() || "ws_default";
  const userId = url.searchParams.get("userId")?.trim() || "usr_alice";
  try {
    const snapshot = await createWorkspaceDashboard({
      workspaceId,
      userId,
    });
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: snapshot,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_CREATE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
