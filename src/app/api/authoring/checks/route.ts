import { handleAuthoringChecksPutRoute } from "@/server/authoring/checks-service";
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

    const forwardedRequest = new Request(request.url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(
        isRecord(payload)
          ? {
              ...payload,
              workspaceId: session.workspaceId,
              userId: session.userId,
            }
          : payload,
      ),
    });
    return handleAuthoringChecksPutRoute(forwardedRequest);
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
