import { saveEditingSessionService } from "@/server/authoring/editing-session-service";
import { serviceResultToApiResponse } from "@/server/service-result";

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

  return serviceResultToApiResponse(await saveEditingSessionService(payload));
}
