import "server-only";

import type { AthenaConnectionSecret, DatasourceEngineKind } from "./datasource-types";

export interface ParsedCreateDatasourceRequest {
  engine_kind: DatasourceEngineKind;
  label: string;
  description: string;
  secretJson: string;
}

export class ParseCreateDatasourceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseCreateDatasourceRequestError";
  }
}

function validationError(message: string): never {
  throw new ParseCreateDatasourceRequestError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateDatasourceRequest(payload: unknown): ParsedCreateDatasourceRequest {
  if (!isRecord(payload)) {
    validationError("Invalid payload.");
  }

  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";

  if (!label) {
    validationError("label is required.");
  }

  const explicitKind = payload.engine_kind;
  const connectionUrl =
    isRecord(payload.postgres) && typeof payload.postgres.connectionUrl === "string"
      ? payload.postgres.connectionUrl.trim()
      : "";

  if (explicitKind === "athena") {
    if (!isRecord(payload.athena)) {
      validationError("athena configuration is required.");
    }
    const a = payload.athena;
    const region = typeof a.region === "string" ? a.region.trim() : "";
    const database = typeof a.database === "string" ? a.database.trim() : "";
    const outputLocation =
      typeof a.outputLocation === "string" ? a.outputLocation.trim() : "";

    if (!region || !database || !outputLocation) {
      validationError("athena region, database, and outputLocation are required.");
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
    validationError("engine_kind must be postgres or athena.");
  }

  if (!connectionUrl) {
    validationError("Postgres connectionUrl is required.");
  }

  return {
    engine_kind: "postgres",
    label,
    description,
    secretJson: JSON.stringify({ connectionUrl }),
  };
}
