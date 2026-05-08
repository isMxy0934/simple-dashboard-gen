import {
  getWorkspaceUserSettingsService,
  updateWorkspaceUserVerboseSettingService,
} from "@/server/workspace/service";
import { serviceResultToApiResponse } from "@/server/service-result";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();

  if (!workspaceId || !userId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_WORKSPACE_OR_USER", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await getWorkspaceUserSettingsService({ workspaceId, userId }),
  );
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

  return serviceResultToApiResponse(
    await updateWorkspaceUserVerboseSettingService(payload),
  );
}
