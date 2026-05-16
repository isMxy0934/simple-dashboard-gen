import type { DashboardListMode } from "../../../contracts";
import {
  createDashboardService,
  listDashboardsService,
} from "../../../server/dashboards/service";
import { serviceResultToApiResponse } from "../../../server/service-result";

function resolveMode(input: string | null): DashboardListMode {
  return input === "viewer" ? "viewer" : "authoring";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = resolveMode(url.searchParams.get("mode"));
  const workspaceId = url.searchParams.get("workspaceId")?.trim();

  if (!workspaceId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_WORKSPACE_ID", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await listDashboardsService({ workspaceId, mode }),
  );
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const templateId = url.searchParams.get("templateId")?.trim() || undefined;
  const templateVersion =
    url.searchParams.get("templateVersion")?.trim() || undefined;

  if (!workspaceId || !userId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_WORKSPACE_OR_USER", data: null },
      { status: 400 },
    );
  }

  return serviceResultToApiResponse(
    await createDashboardService({
      workspaceId,
      userId,
      templateId,
      templateVersion,
    }),
  );
}
