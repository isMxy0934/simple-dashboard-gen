import "server-only";

import type { BindingRow, DatasourceContext, JsonValue, QueryDef } from "../../contracts";
import { resolveEngine } from "./engine-registry";
import { buildDatasourceContextFromIntrospection } from "./datasource-context-builder";
import { resolveDatasourceSecretForExecution } from "./datasource-resolve";

export async function loadDatasourceContext(
  datasourceId: string,
  workspaceId?: string,
): Promise<DatasourceContext> {
  const { kind, secretJson } = await resolveDatasourceSecretForExecution(
    datasourceId,
    workspaceId,
  );
  const schemas = await resolveEngine(kind).introspectSchema(secretJson);
  return buildDatasourceContextFromIntrospection(datasourceId, kind, schemas);
}

export async function executeDatasourceQuery(
  query: QueryDef,
  params: Record<string, JsonValue>,
  workspaceId?: string,
  options: { rowLimit?: number } = {},
): Promise<BindingRow[]> {
  const { kind, secretJson } = await resolveDatasourceSecretForExecution(
    query.datasource_id,
    workspaceId,
  );
  return resolveEngine(kind).executeReadOnlyQuery(secretJson, query, params, options);
}
