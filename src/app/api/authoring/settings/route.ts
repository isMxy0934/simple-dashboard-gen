import {
  getWorkspaceUserSettingsService,
  updateWorkspaceUserSettingsService,
} from "@/server/workspace/service";
import { serviceResultToApiResponse } from "@/server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  isRecord,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
    return serviceResultToApiResponse(
      await getWorkspaceUserSettingsService({
        workspaceId: session.workspaceId,
        userId: session.userId,
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  let session;
  try {
    session = await requireApiSession(request, Permission.DashboardRead);
  } catch (error) {
    return apiErrorToResponse(error);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  if (!isRecord(payload) || (!("verbose" in payload) && !("locale" in payload))) {
    return Response.json(
      { status_code: 400, reason: "INVALID_SETTINGS_REQUEST", data: null },
      { status: 400 },
    );
  }

  try {
    return serviceResultToApiResponse(
      await updateWorkspaceUserSettingsService({
        ...payload,
        workspaceId: session.workspaceId,
        userId: session.userId,
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
