import { deleteCustomDatasource } from "../../../../server/datasource/datasource-admin-service";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;

  const removed = await deleteCustomDatasource(datasourceId);
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
