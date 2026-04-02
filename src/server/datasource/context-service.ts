import type { DatasourceContext } from "@/contracts";
import type { DatasourceListItemSummary } from "@/agent/dashboard-agent/contracts/agent-contract";
import {
  listAvailableDatasourceDefinitions,
  loadDatasourceContext,
} from "./postgres-datasource";

export async function listAgentDatasources(): Promise<DatasourceListItemSummary[]> {
  return listAvailableDatasourceDefinitions().map((datasource) => ({
    datasource_id: datasource.datasource_id,
    label: datasource.label,
    description: datasource.description,
  }));
}

export async function loadAgentDatasourceSchema(
  datasourceId: string,
): Promise<DatasourceContext> {
  return loadDatasourceContext(datasourceId);
}

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
