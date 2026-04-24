import "server-only";

import {
  deleteDatasourceConnection,
  decryptConnectionSecretJson,
  getDatasourceConnectionById,
  insertDatasourceConnection,
  listDatasourceConnections,
} from "./datasource-connection-repository";
import { resolveEngine } from "./engine-registry";
import type { DatasourceEngineKind } from "./datasource-types";
import type { IntrospectedSchema } from "./postgres-introspect";
import { findDatasourceDashboardReferences } from "../cloud/repository";

export interface ManagementDatasourceSummary {
  datasource_id: string;
  label: string;
  description: string;
  engine_kind: DatasourceEngineKind;
}

export type DatasourceSchemaTreeResponse = {
  datasource_id: string;
  dialect: "postgres" | "athena";
  schemas: IntrospectedSchema[];
};

export async function listManagementDatasources(): Promise<{
  datasources: ManagementDatasourceSummary[];
}> {
  const stored = await listDatasourceConnections();
  return {
    datasources: stored.map((row) => ({
      datasource_id: row.id,
      label: row.label,
      description: row.description,
      engine_kind: row.kind,
    })),
  };
}

export async function getDatasourceSchemaTree(
  datasourceId: string,
): Promise<DatasourceSchemaTreeResponse> {
  const row = await getDatasourceConnectionById(datasourceId);
  if (!row) {
    throw new Error("Datasource not found.");
  }

  const secretJson = decryptConnectionSecretJson(row);
  const schemas = await resolveEngine(row.kind).introspectSchema(secretJson);
  return {
    datasource_id: datasourceId,
    dialect: row.kind,
    schemas,
  };
}

export class DatasourceConnectionTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasourceConnectionTestError";
  }
}

export class DatasourceInUseError extends Error {
  readonly datasourceId: string;
  readonly referenceCount: number;
  readonly dashboardIds: string[];

  constructor(input: {
    datasourceId: string;
    referenceCount: number;
    dashboardIds: string[];
  }) {
    super("DATASOURCE_IN_USE");
    this.name = "DatasourceInUseError";
    this.datasourceId = input.datasourceId;
    this.referenceCount = input.referenceCount;
    this.dashboardIds = input.dashboardIds;
  }
}

export async function createDatasource(input: {
  engine_kind: DatasourceEngineKind;
  label: string;
  description: string;
  secretJson: string;
}): Promise<ManagementDatasourceSummary> {
  const engine = resolveEngine(input.engine_kind);
  try {
    await engine.testConnection(input.secretJson);
  } catch (err) {
    throw new DatasourceConnectionTestError(
      err instanceof Error ? err.message : "Connection test failed.",
    );
  }

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
    engine_kind: row.kind,
  };
}

export async function deleteCustomDatasource(datasourceId: string): Promise<boolean> {
  const existing = await getDatasourceConnectionById(datasourceId);
  if (!existing) {
    return false;
  }

  const references = await findDatasourceDashboardReferences(datasourceId);
  if (references.reference_count > 0) {
    throw new DatasourceInUseError({
      datasourceId,
      referenceCount: references.reference_count,
      dashboardIds: references.dashboard_ids,
    });
  }

  return deleteDatasourceConnection(datasourceId);
}
