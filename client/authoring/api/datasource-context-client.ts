import type { DatasourceContext } from "../../../contracts";

interface DatasourceContextResponse {
  status_code?: number;
  reason?: string;
  data?: {
    datasource_context?: DatasourceContext;
  } | null;
}

export async function loadAuthoringDatasourceContext(): Promise<DatasourceContext> {
  const response = await fetch("/api/datasource/context", {
    cache: "no-store",
  });
  const payload = (await response.json()) as DatasourceContextResponse;

  if (payload.status_code !== 200 || !payload.data?.datasource_context) {
    throw new Error(payload.reason || "Datasource context is unavailable.");
  }

  return payload.data.datasource_context;
}
