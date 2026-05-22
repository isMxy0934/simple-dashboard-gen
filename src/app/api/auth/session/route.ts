import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        user_id: session.userId,
        workspace_id: session.workspaceId,
        permissions: [...session.permissions],
        expires_at: session.expiresAt,
      },
    });
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
