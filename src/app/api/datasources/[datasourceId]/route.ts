import { deleteCustomDatasource } from "../../../../server/datasource/datasource-admin-service";
import { isBuiltinDatasourceId } from "../../../../server/datasource/datasource-builtin";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;

  if (isBuiltinDatasourceId(datasourceId)) {
    return Response.json(
      {
        status_code: 400,
        reason: "BUILTIN_DATASOURCE_IMMUTABLE",
        data: null,
      },
      { status: 400 },
    );
  }

  const removed = await deleteCustomDatasource(datasourceId);
  if (!removed) {
    return Response.json(
      {
        status_code: 404,
        reason: "DATASOURCE_NOT_FOUND",
        data: null,
      },
      { status: 404 },
    );
  }

  return Response.json({
    status_code: 200,
    reason: "OK",
    data: { datasource_id: datasourceId },
  });
}
