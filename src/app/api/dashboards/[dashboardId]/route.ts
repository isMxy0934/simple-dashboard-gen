import type { DashboardListMode } from "../../../../contracts";
import {
  deleteDashboardService,
  getDashboardService,
} from "../../../../server/dashboards/service";
import { serviceResultToApiResponse } from "../../../../server/service-result";

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
  const workspaceId = url.searchParams.get("workspaceId")?.trim();

  if (!workspaceId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_WORKSPACE_ID", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await getDashboardService({ workspaceId, dashboardId, mode }),
  );
}

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
    await deleteDashboardService({ workspaceId, dashboardId }),
  );
}
