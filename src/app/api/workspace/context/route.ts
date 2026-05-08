import { getWorkspaceContext } from "@/server/cloud/repository";
import { DEFAULT_WORKSPACE_ID } from "@/shared/workspace-defaults";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId")?.trim() ||
    DEFAULT_WORKSPACE_ID;

  try {
    const context = await getWorkspaceContext(workspaceId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: context,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "WORKSPACE_CONTEXT_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
