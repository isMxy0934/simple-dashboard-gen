import { unpublishDashboardService } from "../../../../../server/dashboards/service";
import { serviceResultToApiResponse } from "../../../../../server/service-result";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ dashboardId: string }> },
): Promise<Response> {
  const { dashboardId } = await context.params;
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();

  if (!workspaceId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_WORKSPACE_ID", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await unpublishDashboardService({ workspaceId, dashboardId }),
  );
}
