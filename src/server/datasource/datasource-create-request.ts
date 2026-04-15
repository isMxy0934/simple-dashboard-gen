import "server-only";

import type { AthenaConnectionSecret, DatasourceEngineKind } from "./datasource-types";

export interface ParsedCreateDatasourceRequest {
  engine_kind: DatasourceEngineKind;
  label: string;
  description: string;
  secretJson: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateDatasourceRequest(payload: unknown): ParsedCreateDatasourceRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid payload.");
  }

  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";

  if (!label) {
    throw new Error("label is required.");
  }

  const explicitKind = payload.engine_kind;
  const legacyPostgresUrl =
    typeof payload.postgres_url === "string" ? payload.postgres_url.trim() : "";
  const fromNested =
    isRecord(payload.postgres) && typeof payload.postgres.connectionUrl === "string"
      ? payload.postgres.connectionUrl.trim()
      : "";
  const connectionUrl = legacyPostgresUrl || fromNested;

  if (explicitKind === "athena") {
    if (!isRecord(payload.athena)) {
      throw new Error("athena configuration is required.");
    }
    const a = payload.athena;
    const region = typeof a.region === "string" ? a.region.trim() : "";
    const database = typeof a.database === "string" ? a.database.trim() : "";
    const outputLocation =
      typeof a.outputLocation === "string" ? a.outputLocation.trim() : "";

    if (!region || !database || !outputLocation) {
      throw new Error("athena region, database, and outputLocation are required.");
    }

    const secret: AthenaConnectionSecret = {
      region,
      database,
      outputLocation,
      workgroup: typeof a.workgroup === "string" ? a.workgroup.trim() || undefined : undefined,
      catalog: typeof a.catalog === "string" ? a.catalog.trim() || undefined : undefined,
      accessKeyId:
        typeof a.accessKeyId === "string" ? a.accessKeyId.trim() || undefined : undefined,
      secretAccessKey:
        typeof a.secretAccessKey === "string"
          ? a.secretAccessKey.trim() || undefined
          : undefined,
      sessionToken:
        typeof a.sessionToken === "string" ? a.sessionToken.trim() || undefined : undefined,
    };

    return {
      engine_kind: "athena",
      label,
      description,
      secretJson: JSON.stringify(secret),
    };
  }

  if (explicitKind !== undefined && explicitKind !== "postgres") {
    throw new Error("engine_kind must be postgres or athena.");
  }

  if (!connectionUrl) {
    throw new Error("Postgres connectionUrl (or postgres_url) is required.");
  }

  return {
    engine_kind: "postgres",
    label,
    description,
    secretJson: JSON.stringify({ connectionUrl }),
  };
}
