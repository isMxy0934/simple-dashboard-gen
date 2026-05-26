import type { DashboardListMode } from "../../../contracts";
import {
  createDashboardService,
  listDashboardsService,
} from "../../../server/dashboards/service";
import { serviceResultToApiResponse } from "../../../server/service-result";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

function resolveMode(input: string | null): DashboardListMode {
  return input === "viewer" ? "viewer" : "authoring";
}

function dashboardReadPermissionForMode(mode: DashboardListMode) {
  return mode === "authoring" ? Permission.DashboardEdit : Permission.DashboardRead;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = resolveMode(url.searchParams.get("mode"));

  try {
    const session = await requireApiSession(
      request,
      dashboardReadPermissionForMode(mode),
      { skipCsrf: true },
    );
    return serviceResultToApiResponse(
      await listDashboardsService({ workspaceId: session.workspaceId, mode }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const templateId = url.searchParams.get("templateId")?.trim() || undefined;
  const templateVersion =
    url.searchParams.get("templateVersion")?.trim() || undefined;

  try {
    const session = await requireApiSession(request, Permission.DashboardEdit);
    return serviceResultToApiResponse(
      await createDashboardService({
        workspaceId: session.workspaceId,
        userId: session.userId,
        templateId,
        templateVersion,
      }),
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
