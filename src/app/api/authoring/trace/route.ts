import { readAuthoringTraceSummary } from "@/server/logs/session-log-reader";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const chatSessionId = url.searchParams.get("chatSessionId")?.trim();

  if (
    url.searchParams.has("sessionId") ||
    !workspaceId ||
    !userId ||
    !dashboardId ||
    !chatSessionId
  ) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_TRACE_SCOPE", data: null },
      { status: 400 },
    );
  }

  try {
    const events = await readAuthoringTraceSummary({
      dashboardId,
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId,
        userId,
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
