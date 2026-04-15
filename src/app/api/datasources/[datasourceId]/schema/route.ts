import { getDatasourceSchemaTree } from "../../../../../server/datasource/datasource-admin-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ datasourceId: string }> },
): Promise<Response> {
  const { datasourceId } = await context.params;

  try {
    const data = await getDatasourceSchemaTree(datasourceId);
    return Response.json({ status_code: 200, reason: "OK", data });
  } catch (error) {
    const isNotFound =
      error instanceof Error && error.message.toLowerCase().includes("not found");
    return Response.json(
      {
        status_code: isNotFound ? 404 : 502,
        reason: isNotFound ? "DATASOURCE_NOT_FOUND" : "SCHEMA_LOAD_FAILED",
        data: null,
      },
      { status: isNotFound ? 404 : 502 },
    );
  }
}
