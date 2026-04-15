export type AuthoringDatasourceEngineKind = "postgres" | "athena";

export interface AuthoringDatasourceSummary {
  datasource_id: string;
  label: string;
  description: string;
  engine_kind: AuthoringDatasourceEngineKind;
}

export async function fetchAuthoringDatasources(): Promise<AuthoringDatasourceSummary[]> {
  const response = await fetch("/api/datasources", { cache: "no-store" });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: { datasources: AuthoringDatasourceSummary[] };
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to load datasources.");
  }

  return payload.data.datasources;
}
