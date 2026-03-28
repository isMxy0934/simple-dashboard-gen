import { loadDatasourceContext } from "./postgres-datasource";

export async function handleDatasourceContextRoute(): Promise<Response> {
  try {
    const datasourceContext = await loadDatasourceContext();

    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        datasource_context: datasourceContext,
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error
            ? error.message
            : "Datasource context is unavailable.",
        data: null,
      },
      { status: 503 },
    );
  }
}
