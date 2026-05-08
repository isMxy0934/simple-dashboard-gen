import { getWorkspaceContextService } from "@/server/workspace/service";
import { serviceResultToApiResponse } from "@/server/service-result";

export async function GET(request: Request): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();

  if (!workspaceId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_WORKSPACE_ID", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await getWorkspaceContextService({ workspaceId }),
  );
}
