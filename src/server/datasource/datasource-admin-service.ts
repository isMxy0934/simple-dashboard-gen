import "server-only";

import { Pool } from "pg";
import { listAvailableDatasourceDefinitions } from "./postgres-datasource";
import {
  appendDatasourceEntry,
  getRegistryEntryById,
  isBuiltinDatasourceId,
  readDatasourceRegistry,
  removeDatasourceEntry,
} from "./datasource-registry";
import { introspectPostgresSchemas, type IntrospectedSchema } from "./postgres-introspect";
import { getPgPool } from "./postgres";

export interface ManagementDatasourceSummary {
  datasource_id: string;
  label: string;
  description: string;
  kind: "builtin" | "custom";
}

function createEphemeralPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 5000,
  });
}

export async function listManagementDatasources(): Promise<{
  datasources: ManagementDatasourceSummary[];
}> {
  const builtins = listAvailableDatasourceDefinitions();
  const registry = await readDatasourceRegistry();

  return {
    datasources: [
      ...builtins.map((entry) => ({
        datasource_id: entry.datasource_id,
        label: entry.label,
        description: entry.description,
        kind: "builtin" as const,
      })),
      ...registry.map((entry) => ({
        datasource_id: entry.id,
        label: entry.label,
        description: entry.description,
        kind: "custom" as const,
      })),
    ],
  };
}

export async function getDatasourceSchemaTree(
  datasourceId: string,
): Promise<{ datasource_id: string; dialect: "postgres"; schemas: IntrospectedSchema[] }> {
  let pool: Pool;
  let shouldClose = false;

  if (isBuiltinDatasourceId(datasourceId)) {
    if (datasourceId !== "ds_sales_weekly") {
      throw new Error("Unknown builtin datasource.");
    }
    pool = getPgPool();
  } else {
    const entry = await getRegistryEntryById(datasourceId);
    if (!entry) {
      throw new Error("Datasource not found.");
    }
    pool = createEphemeralPool(entry.postgres_url);
    shouldClose = true;
  }

  try {
    const schemas = await introspectPostgresSchemas(pool);
    return {
      datasource_id: datasourceId,
      dialect: "postgres",
      schemas,
    };
  } finally {
    if (shouldClose) {
      await pool.end().catch(() => undefined);
    }
  }
}

export async function testPostgresConnection(connectionString: string): Promise<void> {
  const pool = createEphemeralPool(connectionString.trim());
  try {
    await pool.query("select 1 as ok");
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function addCustomDatasource(input: {
  label: string;
  description: string;
  postgres_url: string;
}): Promise<ManagementDatasourceSummary> {
  await testPostgresConnection(input.postgres_url);
  const entry = await appendDatasourceEntry({
    label: input.label,
    description: input.description,
    postgres_url: input.postgres_url,
  });

  return {
    datasource_id: entry.id,
    label: entry.label,
    description: entry.description,
    kind: "custom",
  };
}

export async function deleteCustomDatasource(datasourceId: string): Promise<boolean> {
  return removeDatasourceEntry(datasourceId);
}
