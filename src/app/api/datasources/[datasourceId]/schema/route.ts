import { getDatasourceSchemaTree } from "../../../../../server/datasource/datasource-admin-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;

  try {
    const data = await getDatasourceSchemaTree(datasourceId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCHEMA_LOAD_FAILED";
    return Response.json(
      {
        status_code: 400,
        reason: message,
        data: null,
      },
      { status: 400 },
    );
  }
}
