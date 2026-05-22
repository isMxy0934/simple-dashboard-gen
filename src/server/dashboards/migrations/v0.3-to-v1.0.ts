import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";

export function migrateV03ToV10(input: unknown): unknown {
  if (!isRecord(input)) return input;
  return {
    ...input,
    schema_version: CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
