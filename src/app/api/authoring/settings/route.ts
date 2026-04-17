import {
  getWorkspaceUserSettings,
  updateWorkspaceUserVerboseSetting,
} from "@/server/cloud/repository";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim() || "ws_default";
  const userId = url.searchParams.get("userId")?.trim() || "usr_alice";

  try {
    const settings = await getWorkspaceUserSettings({
      workspaceId,
      userId,
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
          error instanceof Error ? error.message : "AUTHORING_SETTINGS_LOAD_FAILED",
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
    !("userId" in payload) ||
    !("verbose" in payload)
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_SETTINGS_REQUEST", data: null },
      { status: 400 },
    );
  }

  try {
    const settings = await updateWorkspaceUserVerboseSetting({
      workspaceId: String(payload.workspaceId),
      userId: String(payload.userId),
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
          error instanceof Error ? error.message : "AUTHORING_SETTINGS_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
