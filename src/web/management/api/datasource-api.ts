export type ManagementEngineKind = "postgres" | "athena";

export interface ManagementDatasourceSummary {
  datasource_id: string;
  label: string;
  description: string;
  engine_kind: ManagementEngineKind;
}

export interface DatasourceSchemaResponse {
  datasource_id: string;
  dialect: "postgres" | "athena";
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
  engine_kind: ManagementEngineKind;
  postgres_url?: string;
  athena?: {
    region: string;
    database: string;
    outputLocation: string;
    workgroup?: string;
    catalog?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  };
}): Promise<ManagementDatasourceSummary> {
  const body: Record<string, unknown> = {
    label: input.label,
    description: input.description,
    engine_kind: input.engine_kind,
  };

  if (input.engine_kind === "postgres" && input.postgres_url) {
    body.postgres_url = input.postgres_url;
  }

  if (input.engine_kind === "athena" && input.athena) {
    body.athena = input.athena;
  }

  const response = await fetch("/api/datasources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
