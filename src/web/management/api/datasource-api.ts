export interface ManagementDatasourceSummary {
  datasource_id: string;
  label: string;
  description: string;
  kind: "builtin" | "custom";
}

export interface DatasourceSchemaResponse {
  datasource_id: string;
  dialect: "postgres";
  schemas: Array<{
    name: string;
    tables: Array<{
      name: string;
      columns: Array<{ name: string; data_type: string }>;
    }>;
  }>;
}

export async function fetchManagementDatasources(): Promise<ManagementDatasourceSummary[]> {
  const response = await fetch("/api/datasources", { cache: "no-store" });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: { datasources: ManagementDatasourceSummary[] };
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to load datasources.");
  }

  return payload.data.datasources;
}

export async function fetchDatasourceSchema(
  datasourceId: string,
): Promise<DatasourceSchemaResponse> {
  const response = await fetch(
    `/api/datasources/${encodeURIComponent(datasourceId)}/schema`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: DatasourceSchemaResponse;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to load schema.");
  }

  return payload.data;
}

export async function createDatasource(input: {
  label: string;
  description: string;
  postgres_url: string;
}): Promise<ManagementDatasourceSummary> {
  const response = await fetch("/api/datasources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: ManagementDatasourceSummary;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to create datasource.");
  }

  return payload.data;
}

export async function deleteDatasource(datasourceId: string): Promise<void> {
  const response = await fetch(
    `/api/datasources/${encodeURIComponent(datasourceId)}`,
    { method: "DELETE" },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
  };

  if (!response.ok || payload.status_code !== 200) {
    throw new Error(payload.reason || "Unable to delete datasource.");
  }
}
