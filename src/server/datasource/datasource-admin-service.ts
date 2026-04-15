import "server-only";

import { isBuiltinDatasourceId } from "./datasource-builtin";
import {
  deleteDatasourceConnection,
  decryptConnectionSecretJson,
  getDatasourceConnectionById,
  insertDatasourceConnection,
  listDatasourceConnections,
} from "./datasource-connection-repository";
import { resolveEngine } from "./engine-registry";
import type { DatasourceEngineKind } from "./datasource-types";
import { listAvailableDatasourceDefinitions } from "./postgres-datasource";
import type { IntrospectedSchema } from "./postgres-introspect";

export interface ManagementDatasourceSummary {
  datasource_id: string;
  label: string;
  description: string;
  kind: "builtin" | "custom";
  engine_kind: DatasourceEngineKind;
}

const BUILTIN_ENGINE: DatasourceEngineKind = "postgres";

export async function listManagementDatasources(): Promise<{
  datasources: ManagementDatasourceSummary[];
}> {
  const builtins = listAvailableDatasourceDefinitions().map((entry) => ({
    datasource_id: entry.datasource_id,
    label: entry.label,
    description: entry.description,
    kind: "builtin" as const,
    engine_kind: BUILTIN_ENGINE,
  }));

  const stored = await listDatasourceConnections();
  const custom: ManagementDatasourceSummary[] = stored.map((row) => ({
    datasource_id: row.id,
    label: row.label,
    description: row.description,
    kind: "custom" as const,
    engine_kind: row.kind,
  }));

  return { datasources: [...builtins, ...custom] };
}

export type DatasourceSchemaTreeResponse = {
  datasource_id: string;
  dialect: "postgres" | "athena";
  schemas: IntrospectedSchema[];
};

export async function getDatasourceSchemaTree(
  datasourceId: string,
): Promise<DatasourceSchemaTreeResponse> {
  if (isBuiltinDatasourceId(datasourceId)) {
    if (datasourceId !== "ds_sales_weekly") {
      throw new Error("Unknown builtin datasource.");
    }
    const secretJson = JSON.stringify({ builtinPool: true });
    const schemas = await resolveEngine("postgres").introspectSchema(secretJson);
    return {
      datasource_id: datasourceId,
      dialect: "postgres",
      schemas,
    };
  }

  const row = await getDatasourceConnectionById(datasourceId);
  if (!row) {
    throw new Error("Datasource not found.");
  }

  const secretJson = decryptConnectionSecretJson(row);
  const schemas = await resolveEngine(row.kind).introspectSchema(secretJson);
  return {
    datasource_id: datasourceId,
    dialect: row.kind === "postgres" ? "postgres" : "athena",
    schemas,
  };
}

export async function createDatasource(input: {
  engine_kind: DatasourceEngineKind;
  label: string;
  description: string;
  secretJson: string;
}): Promise<ManagementDatasourceSummary> {
  const engine = resolveEngine(input.engine_kind);
  await engine.testConnection(input.secretJson);

  const row = await insertDatasourceConnection({
    kind: input.engine_kind,
    label: input.label,
    description: input.description,
    secretJson: input.secretJson,
  });

  return {
    datasource_id: row.id,
    label: row.label,
    description: row.description,
    kind: "custom",
    engine_kind: row.kind,
  };
}

export async function deleteCustomDatasource(datasourceId: string): Promise<boolean> {
  return deleteDatasourceConnection(datasourceId);
}
