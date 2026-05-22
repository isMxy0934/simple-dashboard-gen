import { handleAuthoringChatStreamRoute } from "@/server/authoring/stream-service";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";
import { assertRateLimit } from "@/server/guards/rate-limit";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  let requestId: string | null = null;
  try {
    const session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
    requestId = session.requestId;
    await assertRateLimit("agent.stream", session.userId, {
      sessionId: session.sessionId,
      requestId: session.requestId,
    });
    if (!id.startsWith(`${session.workspaceId}:${session.userId}:`)) {
      return Response.json(
        { status_code: 403, reason: "STREAM_SESSION_FORBIDDEN", data: null },
        { status: 403 },
      );
    }
  } catch (error) {
    return apiErrorToResponse(error);
  }
  return handleAuthoringChatStreamRoute(id, requestId);
}
