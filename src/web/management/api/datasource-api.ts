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

export class DatasourceDeleteError extends Error {
  readonly datasourceId: string;
  readonly referenceCount: number;
  readonly dashboardIds: string[];

  constructor(input: {
    datasourceId: string;
    referenceCount: number;
    dashboardIds: string[];
  }) {
    super("DATASOURCE_IN_USE");
    this.name = "DatasourceDeleteError";
    this.datasourceId = input.datasourceId;
    this.referenceCount = input.referenceCount;
    this.dashboardIds = input.dashboardIds;
  }
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
  postgres?: {
    connectionUrl: string;
    schemaAllowlist?: string[];
  };
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

  if (input.engine_kind === "postgres" && input.postgres) {
    body.postgres = input.postgres;
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
    data?: {
      datasource_id?: string;
      reference_count?: number;
      dashboard_ids?: string[];
    } | null;
  };

  if (payload.status_code === 409 && payload.reason === "DATASOURCE_IN_USE") {
    throw new DatasourceDeleteError({
      datasourceId: payload.data?.datasource_id ?? datasourceId,
      referenceCount: payload.data?.reference_count ?? 0,
      dashboardIds: Array.isArray(payload.data?.dashboard_ids)
        ? payload.data.dashboard_ids.slice(0, 5)
        : [],
    });
  }

  if (!response.ok || payload.status_code !== 200) {
    throw new Error(payload.reason || "Unable to delete datasource.");
  }
}
