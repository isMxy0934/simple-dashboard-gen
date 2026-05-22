import { migrateV03ToV10 } from "./v0.3-to-v1.0";

export function migrateToCurrent(input: unknown): unknown {
  if (isRecord(input) && input.schema_version === "1.0") {
    return input;
  }
  if (isRecord(input) && isRecord(input.dashboard_spec) && input.dashboard_spec.schema_version === "0.3") {
    return migrateV03ToV10(input);
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
