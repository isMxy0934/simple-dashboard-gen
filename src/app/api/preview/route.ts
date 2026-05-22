import { handlePreviewRoute } from "../../../server/execution/query-service";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";
import { assertRateLimit } from "@/server/guards/rate-limit";

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(request, Permission.DashboardRead);
    await assertRateLimit("query", session.userId, {
      sessionId: session.sessionId,
      requestId: session.requestId,
    });
    return handlePreviewRoute(request, { workspaceId: session.workspaceId });
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
