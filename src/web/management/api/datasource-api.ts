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

export interface DatasourceFailureDiagnostic {
  engine_kind?: ManagementEngineKind;
  stage?: "connection_test" | "schema_load";
  code?: string;
  message?: string;
  raw_code?: string;
  http_status?: number;
  metadata?: Record<string, string | number | boolean>;
  hints?: string[];
}

export class DatasourceRequestError extends Error {
  readonly reason: string;
  readonly diagnostic: DatasourceFailureDiagnostic | null;

  constructor(input: {
    message: string;
    reason: string;
    diagnostic?: DatasourceFailureDiagnostic | null;
  }) {
    super(input.message);
    this.name = "DatasourceRequestError";
    this.reason = input.reason;
    this.diagnostic = input.diagnostic ?? null;
  }
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

function isDiagnostic(value: unknown): value is DatasourceFailureDiagnostic {
  return typeof value === "object" && value !== null;
}

function getDiagnostic(data: unknown): DatasourceFailureDiagnostic | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const diagnostic = (data as { diagnostic?: unknown }).diagnostic;
  return isDiagnostic(diagnostic) ? diagnostic : null;
}

function requestMessage(
  reason: string | undefined,
  diagnostic: DatasourceFailureDiagnostic | null,
  fallback: string,
) {
  return diagnostic?.message || reason || fallback;
}

function buildDatasourceBody(input: {
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
}): Record<string, unknown> {
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

  return body;
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
    data?: DatasourceSchemaResponse | { diagnostic?: DatasourceFailureDiagnostic } | null;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data || !("schemas" in payload.data)) {
    const diagnostic = getDiagnostic(payload.data);
    throw new DatasourceRequestError({
      message: requestMessage(payload.reason, diagnostic, "Unable to load schema."),
      reason: payload.reason || "SCHEMA_LOAD_FAILED",
      diagnostic,
    });
  }

  return payload.data;
}

interface DatasourceMutationInput {
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
}

export async function testDatasourceConnection(input: DatasourceMutationInput): Promise<void> {
  const response = await fetch("/api/datasources/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDatasourceBody(input)),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: { ok?: true; diagnostic?: DatasourceFailureDiagnostic } | null;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data?.ok) {
    const diagnostic = getDiagnostic(payload.data);
    throw new DatasourceRequestError({
      message: requestMessage(payload.reason, diagnostic, "Unable to test datasource."),
      reason: payload.reason || "DATASOURCE_TEST_FAILED",
      diagnostic,
    });
  }
}

export async function createDatasource(input: DatasourceMutationInput): Promise<ManagementDatasourceSummary> {
  const response = await fetch("/api/datasources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDatasourceBody(input)),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: ManagementDatasourceSummary | { diagnostic?: DatasourceFailureDiagnostic } | null;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data || !("datasource_id" in payload.data)) {
    const diagnostic = getDiagnostic(payload.data);
    throw new DatasourceRequestError({
      message: requestMessage(payload.reason, diagnostic, "Unable to create datasource."),
      reason: payload.reason || "DATASOURCE_SAVE_FAILED",
      diagnostic,
    });
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
