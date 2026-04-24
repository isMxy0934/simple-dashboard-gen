import {
  DatasourceInUseError,
  deleteCustomDatasource,
} from "../../../../server/datasource/datasource-admin-service";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;

  let removed = false;
  try {
    removed = await deleteCustomDatasource(datasourceId);
  } catch (error) {
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
