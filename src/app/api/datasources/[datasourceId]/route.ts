import {
  DatasourceInUseError,
  deleteCustomDatasourceForWorkspace,
  getManagementDatasourceForWorkspace,
} from "../../../../server/datasource/datasource-admin-service";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

export async function GET(
  request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;

  try {
    const session = await requireApiSession(
      request,
      Permission.DatasourceManage,
      { skipCsrf: true },
    );
    const data = await getManagementDatasourceForWorkspace(
      datasourceId,
      session.workspaceId,
    );
    if (!data) {
      return Response.json(
        { status_code: 404, reason: "DATASOURCE_NOT_FOUND", data: null },
        { status: 404 },
      );
    }
    return Response.json({
      status_code: 200,
      reason: "OK",
      data,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiErrorToResponse(error);
    }
    return Response.json(
      { status_code: 503, reason: "DATASOURCE_LOAD_FAILED", data: null },
      { status: 503 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;

  let removed = false;
  try {
    const session = await requireApiSession(request, Permission.DatasourceManage);
    removed = await deleteCustomDatasourceForWorkspace(
      datasourceId,
      session.workspaceId,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") {
      return apiErrorToResponse(error);
    }
    if (error instanceof DatasourceInUseError) {
      return Response.json(
        {
          status_code: 409,
          reason: "DATASOURCE_IN_USE",
          data: {
            datasource_id: error.datasourceId,
            reference_count: error.referenceCount,
            dashboard_ids: error.dashboardIds,
          },
        },
        { status: 409 },
      );
    }

    throw error;
  }

  if (!removed) {
    return Response.json(
      { status_code: 404, reason: "DATASOURCE_NOT_FOUND", data: null },
      { status: 404 },
    );
  }

  return Response.json({
    status_code: 200,
    reason: "OK",
    data: { datasource_id: datasourceId },
  });
}
