import { listEditingPresence } from "@/server/cloud/repository";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId =
    url.searchParams.get("workspaceId")?.trim() || DEFAULT_WORKSPACE_ID;
  const dashboardId = url.searchParams.get("dashboardId")?.trim();

  if (!dashboardId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_DASHBOARD_ID", data: null },
      { status: 400 },
    );
  }

  try {
    const presence = await listEditingPresence({
      workspaceId,
      dashboardId,
    });
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        presence,
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "WORKSPACE_PRESENCE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
