import { getWorkspaceContext } from "@/server/cloud/repository";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId")?.trim() || "ws_default";

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
