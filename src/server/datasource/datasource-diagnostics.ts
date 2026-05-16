import "server-only";

import { DatasourceEngineDiagnosticError } from "./datasource-engine";
import type { DatasourceEngineKind } from "./datasource-types";

export type DatasourceFailureStage = "connection_test" | "schema_load";

export interface DatasourceFailureDiagnostic {
  engine_kind: DatasourceEngineKind;
  stage: DatasourceFailureStage;
  code: string;
  message: string;
  raw_code?: string;
  http_status?: number;
  metadata?: Record<string, string | number | boolean>;
  hints: string[];
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+):([^@\s]+)@/gi, "$1:****@")
    .replace(/((?:password|pwd|secretAccessKey|secret_access_key)\s*[:=]\s*)["']?[^"',\s]+/gi, "$1****")
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "$1****************");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? sanitizeDiagnosticText(value.trim()) : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactMetadata(
  metadata: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = sanitizeDiagnosticText(value.trim());
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function diagnosticErrorMetadata(
  error: unknown,
): Record<string, string | number | boolean> | undefined {
  if (error instanceof DatasourceEngineDiagnosticError) {
    return compactMetadata(error.metadata);
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return sanitizeDiagnosticText(error.message.trim());
  }
  return "Datasource connection failed.";
}

function errorRawCode(error: unknown): string | undefined {
  if (error instanceof DatasourceEngineDiagnosticError) {
    return error.code;
  }

  const record = asRecord(error);
  return (
    asString(record.code) ??
    asString(record.name) ??
    (error instanceof Error ? asString(error.name) : undefined)
  );
}

function errorHttpStatus(error: unknown): number | undefined {
  const metadata = asRecord(asRecord(error).$metadata);
  return asNumber(metadata.httpStatusCode);
}

function inferPostgresCode(rawCode: string | undefined, message: string): string {
  const haystack = `${rawCode ?? ""} ${message}`.toLowerCase();
  if (rawCode === "28P01" || haystack.includes("password authentication failed")) {
    return "POSTGRES_AUTH_FAILED";
  }
  if (rawCode === "3D000" || haystack.includes("database") && haystack.includes("does not exist")) {
    return "POSTGRES_DATABASE_NOT_FOUND";
  }
  if (
    rawCode === "42501" ||
    haystack.includes("permission denied") ||
    haystack.includes("insufficient privilege")
  ) {
    return "POSTGRES_PERMISSION_DENIED";
  }
  if (
    rawCode === "ENOTFOUND" ||
    rawCode === "ECONNREFUSED" ||
    rawCode === "ETIMEDOUT" ||
    rawCode === "EAI_AGAIN" ||
    haystack.includes("timeout") ||
    haystack.includes("getaddrinfo") ||
    haystack.includes("connection refused")
  ) {
    return "POSTGRES_NETWORK_FAILED";
  }
  if (haystack.includes("schema(s) not found")) {
    return "POSTGRES_SCHEMA_NOT_FOUND";
  }
  return "POSTGRES_CONNECTION_FAILED";
}

function inferAthenaCode(rawCode: string | undefined, message: string): string {
  const haystack = `${rawCode ?? ""} ${message}`.toLowerCase();
  if (
    haystack.includes("invalidsignature") ||
    haystack.includes("unrecognizedclient") ||
    haystack.includes("expiredtoken") ||
    haystack.includes("security token") ||
    haystack.includes("credentials")
  ) {
    return "ATHENA_CREDENTIALS_INVALID";
  }
  if (
    haystack.includes("accessdenied") ||
    haystack.includes("access denied") ||
    haystack.includes("not authorized") ||
    haystack.includes("permission")
  ) {
    return "ATHENA_PERMISSION_DENIED";
  }
  if (
    haystack.includes("outputlocation") ||
    haystack.includes("output location") ||
    haystack.includes("s3") ||
    haystack.includes("bucket")
  ) {
    return "ATHENA_OUTPUT_LOCATION_FAILED";
  }
  if (
    haystack.includes("workgroup") ||
    haystack.includes("work group")
  ) {
    return "ATHENA_WORKGROUP_FAILED";
  }
  if (
    haystack.includes("database") ||
    haystack.includes("catalog") ||
    haystack.includes("glue")
  ) {
    return "ATHENA_DATABASE_OR_CATALOG_FAILED";
  }
  if (haystack.includes("region")) {
    return "ATHENA_REGION_FAILED";
  }
  if (haystack.includes("timed out") || haystack.includes("timeout")) {
    return "ATHENA_TIMEOUT";
  }
  return "ATHENA_CONNECTION_FAILED";
}

function hintsFor(code: string): string[] {
  switch (code) {
    case "POSTGRES_AUTH_FAILED":
      return ["Verify username/password and confirm the account can log in from this service."];
    case "POSTGRES_DATABASE_NOT_FOUND":
      return ["Check the database name in the connection URL."];
    case "POSTGRES_PERMISSION_DENIED":
      return ["Grant read-only access to the target schemas and tables."];
    case "POSTGRES_NETWORK_FAILED":
      return ["Check host, port, firewall/VPC rules, SSL requirements, and DNS reachability."];
    case "POSTGRES_SCHEMA_NOT_FOUND":
      return ["Check the allowed schema list, or leave it empty to expose all readable schemas."];
    case "ATHENA_CREDENTIALS_INVALID":
      return ["Check AWS keys, or leave advanced credentials empty to use the server role."];
    case "ATHENA_CONFIGURATION_INCOMPLETE":
      return ["Fill region, Athena workgroup, and S3 query output location before testing."];
    case "ATHENA_PERMISSION_DENIED":
      return ["Grant Athena query permissions, Glue catalog read permissions, and S3 read/write on the output location."];
    case "ATHENA_QUERY_START_FAILED":
      return ["Check Athena service access, workgroup settings, and whether query result configuration is allowed."];
    case "ATHENA_OUTPUT_LOCATION_FAILED":
      return ["Verify the S3 output path exists and the role can write query results to it."];
    case "ATHENA_WORKGROUP_FAILED":
      return ["Check the workgroup name and whether it overrides the query result location."];
    case "ATHENA_DATABASE_OR_CATALOG_FAILED":
      return ["Check Glue catalog, database name, region, and Lake Formation permissions."];
    case "ATHENA_REGION_FAILED":
      return ["Confirm the Athena region matches the Glue catalog and S3 output bucket setup."];
    case "ATHENA_TIMEOUT":
      return ["Athena did not finish the smoke test in time; check workgroup queueing and service health."];
    default:
      return ["Open the engine details below, then verify credentials, network reachability, and required permissions."];
  }
}

export function buildDatasourceFailureDiagnostic(
  engineKind: DatasourceEngineKind,
  stage: DatasourceFailureStage,
  error: unknown,
): DatasourceFailureDiagnostic {
  const message = errorMessage(error);
  const rawCode = errorRawCode(error);
  const inferredCode =
    engineKind === "postgres"
      ? inferPostgresCode(rawCode, message)
      : inferAthenaCode(rawCode, message);
  const diagnosticCode =
    error instanceof DatasourceEngineDiagnosticError &&
    error.code !== "ATHENA_QUERY_FAILED"
      ? error.code
      : undefined;
  const code =
    diagnosticCode ?? inferredCode;

  return {
    engine_kind: engineKind,
    stage,
    code,
    message,
    ...(rawCode ? { raw_code: rawCode } : {}),
    ...(errorHttpStatus(error) ? { http_status: errorHttpStatus(error) } : {}),
    ...(diagnosticErrorMetadata(error) ? { metadata: diagnosticErrorMetadata(error) } : {}),
    hints: hintsFor(code),
  };
}
