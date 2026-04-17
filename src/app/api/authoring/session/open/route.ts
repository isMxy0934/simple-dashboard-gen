import type { OpenSessionRequest } from "@/contracts";
import { openEditingSession } from "@/server/cloud/repository";

function isOpenSessionRequest(value: unknown): value is OpenSessionRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "workspaceId" in value &&
    "userId" in value &&
    "dashboardId" in value &&
    "sessionId" in value
  );
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  if (!isOpenSessionRequest(payload)) {
    return Response.json(
      { status_code: 400, reason: "INVALID_OPEN_SESSION_REQUEST", data: null },
      { status: 400 },
    );
  }

  try {
    const session = await openEditingSession(payload);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: session,
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "MAIN_AGENT_SESSION_OPEN_FAILED";
    const status = reason === "DASHBOARD_NOT_FOUND" ? 404 : 503;
    return Response.json(
      {
        status_code: status,
        reason,
        data: null,
      },
      { status },
    );
  }
}
