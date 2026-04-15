import type { DatasourceContext } from "@/contracts";
import type { DatasourceListItemSummary } from "@/ai/dashboard-agent/contracts/agent-contract";
import { listDatasourceConnections } from "./datasource-connection-repository";
import {
  listAvailableDatasourceDefinitions,
  loadDatasourceContext,
} from "./postgres-datasource";

export async function listAgentDatasources(): Promise<DatasourceListItemSummary[]> {
  const builtins = listAvailableDatasourceDefinitions();
  const stored = await listDatasourceConnections();
  return [
    ...builtins.map((datasource) => ({
      datasource_id: datasource.datasource_id,
      label: datasource.label,
      description: datasource.description,
    })),
    ...stored.map((row) => ({
      datasource_id: row.id,
      label: row.label,
      description: row.description,
    })),
  ];
}

export async function loadAgentDatasourceSchema(
  datasourceId: string,
): Promise<DatasourceContext> {
  return loadDatasourceContext(datasourceId);
}
