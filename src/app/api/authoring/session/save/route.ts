import { saveEditingSessionService } from "@/server/authoring/editing-session-service";
import { serviceResultToApiResponse } from "@/server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  isRecord,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function PUT(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(request, Permission.DashboardEdit);
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return Response.json(
        { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
        { status: 400 },
      );
    }

    const scopedPayload =
      isRecord(payload) && isRecord(payload.payload)
        ? {
            ...payload,
            payload: {
              ...payload.payload,
              workspaceId: session.workspaceId,
              userId: session.userId,
            },
          }
        : payload;
    return serviceResultToApiResponse(await saveEditingSessionService(scopedPayload));
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
