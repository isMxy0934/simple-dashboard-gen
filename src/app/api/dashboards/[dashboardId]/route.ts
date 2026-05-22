import type { DashboardListMode } from "../../../../contracts";
import {
  deleteDashboardService,
  getDashboardService,
} from "../../../../server/dashboards/service";
import { serviceResultToApiResponse } from "../../../../server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

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

  try {
    const session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
    return serviceResultToApiResponse(
      await getDashboardService({
        workspaceId: session.workspaceId,
        dashboardId,
        mode,
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ dashboardId: string }> },
): Promise<Response> {
  const { dashboardId } = await context.params;

  try {
    const session = await requireApiSession(request, Permission.DashboardEdit);
    return serviceResultToApiResponse(
      await deleteDashboardService({
        workspaceId: session.workspaceId,
        dashboardId,
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
