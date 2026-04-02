import {
  getDashboardSnapshot,
  unpublishDashboard,
} from "../../../../../server/dashboards/repository";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ dashboardId: string }> },
): Promise<Response> {
  const { dashboardId } = await context.params;

  try {
    const existing = await getDashboardSnapshot(dashboardId, "viewer");
    if (!existing) {
      return Response.json(
        {
          status_code: 404,
          reason: "PUBLISHED_DASHBOARD_NOT_FOUND",
          data: null,
        },
        { status: 404 },
      );
    }

    await unpublishDashboard(dashboardId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        dashboard_id: dashboardId,
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason: error instanceof Error ? error.message : "DASHBOARD_UNPUBLISH_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
