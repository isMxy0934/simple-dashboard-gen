import { unpublishDashboardService } from "../../../../../server/dashboards/service";
import { serviceResultToApiResponse } from "../../../../../server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ dashboardId: string }> },
): Promise<Response> {
  const { dashboardId } = await context.params;

  try {
    const session = await requireApiSession(request, Permission.DashboardPublish);
    return serviceResultToApiResponse(
      await unpublishDashboardService({
        workspaceId: session.workspaceId,
        dashboardId,
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
