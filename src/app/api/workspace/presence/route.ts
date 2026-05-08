import { listEditingPresenceService } from "@/server/workspace/service";
import { serviceResultToApiResponse } from "@/server/service-result";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const dashboardId = url.searchParams.get("dashboardId")?.trim();

  if (!workspaceId || !dashboardId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_WORKSPACE_OR_DASHBOARD", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await listEditingPresenceService({ workspaceId, dashboardId }),
  );
}
