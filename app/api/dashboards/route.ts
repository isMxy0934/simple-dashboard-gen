import type { DashboardListMode } from "../../../contracts";
import {
  createDashboard,
  listDashboards,
} from "../../../server/dashboards/repository";

function resolveMode(input: string | null): DashboardListMode {
  return input === "viewer" ? "viewer" : "authoring";
}

export async function GET(request: Request): Promise<Response> {
  const mode = resolveMode(new URL(request.url).searchParams.get("mode"));

  try {
    const dashboards = await listDashboards(mode);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        dashboards,
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_LIST_UNAVAILABLE",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function POST(): Promise<Response> {
  try {
    const snapshot = await createDashboard();
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: snapshot,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_CREATE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
