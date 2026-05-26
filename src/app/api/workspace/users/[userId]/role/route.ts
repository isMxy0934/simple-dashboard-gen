import { updateWorkspaceUserRoleService } from "@/server/workspace/service";
import { serviceResultToApiResponse } from "@/server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  isRecord,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  const { userId } = await context.params;
  let session;

  try {
    session = await requireApiSession(request, Permission.WorkspaceAdmin);
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

  if (!isRecord(payload)) {
    return Response.json(
      { status_code: 400, reason: "INVALID_WORKSPACE_ROLE_REQUEST", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await updateWorkspaceUserRoleService({
      workspaceId: session.workspaceId,
      userId,
      roleId: payload.role_id,
    }),
  );
}
