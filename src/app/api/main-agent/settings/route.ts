import { getWorkspaceContext, updateWorkspaceVerboseSetting } from "@/server/cloud/repository";

export async function GET(request: Request): Promise<Response> {
  const workspaceId =
    new URL(request.url).searchParams.get("workspaceId")?.trim() || "ws_default";

  try {
    const context = await getWorkspaceContext(workspaceId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: context.settings,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "MAIN_AGENT_SETTINGS_LOAD_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}

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

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("workspaceId" in payload) ||
    !("verbose" in payload)
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_SETTINGS_REQUEST", data: null },
      { status: 400 },
    );
  }

  try {
    const settings = await updateWorkspaceVerboseSetting({
      workspaceId: String(payload.workspaceId),
      verbose: Boolean(payload.verbose),
    });
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: settings,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "MAIN_AGENT_SETTINGS_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
