import { readAuthoringTraceSummary } from "@/server/logs/session-log-reader";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const chatSessionId = url.searchParams.get("chatSessionId")?.trim();

  if (
    url.searchParams.has("sessionId") ||
    !dashboardId ||
    !chatSessionId
  ) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_TRACE_SCOPE", data: null },
      { status: 400 },
    );
  }

  try {
    const session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
    const events = await readAuthoringTraceSummary({
      dashboardId,
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId: session.workspaceId,
        userId: session.userId,
        dashboardId,
        sessionId: chatSessionId,
      }),
    });
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: { events },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiErrorToResponse(error);
    }
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "AUTHORING_TRACE_LOAD_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
