import { getWorkspaceContextService } from "@/server/workspace/service";
import { serviceResultToApiResponse } from "@/server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
    return serviceResultToApiResponse(
      await getWorkspaceContextService({
        workspaceId: session.workspaceId,
        currentUserId: session.userId,
        currentUserPermissions: [...session.permissions],
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
