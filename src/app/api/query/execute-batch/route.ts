import { handleExecuteBatchRoute } from "../../../../server/execution/query-service";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";
import { assertRateLimit } from "@/server/guards/rate-limit";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(request, Permission.DashboardRead);
    await assertRateLimit("query.execute", session.userId, {
      sessionId: session.sessionId,
      requestId: session.requestId,
    });
    return handleExecuteBatchRoute(request, { workspaceId: session.workspaceId });
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
