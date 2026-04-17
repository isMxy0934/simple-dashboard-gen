import type { SaveSessionRequest } from "@/contracts";
import { saveEditingSession } from "@/server/cloud/repository";

function isSaveSessionRequest(value: unknown): value is SaveSessionRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "payload" in value
  );
}

export async function PUT(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  if (!isSaveSessionRequest(payload)) {
    return Response.json(
      { status_code: 400, reason: "INVALID_SAVE_SESSION_REQUEST", data: null },
      { status: 400 },
    );
  }

  try {
    const saved = await saveEditingSession(payload);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: saved,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "MAIN_AGENT_SESSION_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
