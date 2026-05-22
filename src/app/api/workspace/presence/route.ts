import { listEditingPresenceService } from "@/server/workspace/service";
import { serviceResultToApiResponse } from "@/server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dashboardId = url.searchParams.get("dashboardId")?.trim();

  if (!dashboardId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_DASHBOARD", data: null },
      { status: 400 },
    );
  }

  try {
    const session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
    return serviceResultToApiResponse(
      await listEditingPresenceService({
        workspaceId: session.workspaceId,
        dashboardId,
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
