import type { DatasourceContext } from "@/contracts";
import type { DatasourceListItemSummary } from "@/ai/dashboard-agent/contracts/agent-contract";
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
