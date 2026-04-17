import type { DatasourceContext } from "@/contracts";
import type { DatasourceListItemSummary } from "@/ai/authoring/contracts/tool-io";
import { listDatasourceConnections } from "./datasource-connection-repository";
import { loadDatasourceContext } from "./postgres-datasource";

export async function listAgentDatasources(): Promise<DatasourceListItemSummary[]> {
  try {
    const stored = await listDatasourceConnections();
    return stored.map((row) => ({
      datasource_id: row.id,
      label: row.label,
      description: row.description,
    }));
  } catch (err) {
    console.error("[context-service] listDatasourceConnections failed:", err);
    return [];
  }
}

export async function loadAgentDatasourceSchema(
  datasourceId: string,
): Promise<DatasourceContext> {
  return loadDatasourceContext(datasourceId);
}
