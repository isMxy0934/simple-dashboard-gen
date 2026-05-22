import { saveDashboardDraftService } from "@/server/dashboards/service";
import { serviceResultToApiResponse } from "@/server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  isRecord,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const session = await requireApiSession(request, Permission.DashboardEdit);
    const scopedPayload = isRecord(payload)
      ? {
          ...payload,
          workspaceId: session.workspaceId,
          userId: session.userId,
        }
      : payload;
    const result = await saveDashboardDraftService(scopedPayload);
    if (result.ok) {
      return serviceResultToApiResponse(
        result,
        result.data.changed ? "OK" : "NO_CHANGES",
      );
    }
    return serviceResultToApiResponse(result);
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
