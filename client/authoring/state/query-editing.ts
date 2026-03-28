import { getBindingMode } from "../../../domain/dashboard/bindings";
import { createBlankQuery } from "../../../domain/dashboard/queries";
import { findBindingByViewId, reconcileBindingShape } from "./binding-editing";
import type {
  DashboardDocument,
  QueryDef,
  QueryParamDef,
  ResultSchemaField,
} from "../../../contracts";

export function upsertQuery(queryDefs: QueryDef[], query: QueryDef): void {
  const index = queryDefs.findIndex((candidate) => candidate.id === query.id);
  if (index >= 0) {
    queryDefs[index] = query;
    return;
  }

  queryDefs.push(query);
}

export function addBlankQueryToDashboard(
  document: DashboardDocument,
  viewId: string,
): string | null {
  const view = document.dashboard_spec.views.find((candidate) => candidate.id === viewId);
  if (!view) {
    return null;
  }

  const seed = document.query_defs.length + 1;
  const query = createBlankQuery(seed, view);
  document.query_defs.push(query);
  return query.id;
}

export function updateQueryMeta(
  document: DashboardDocument,
  queryId: string,
  field: "id" | "name" | "datasource_id" | "sql_template",
  value: string,
): string {
  const query = document.query_defs.find((candidate) => candidate.id === queryId);
  if (!query) {
    return queryId;
  }

  const previousId = query.id;
  query[field] = value;

  if (field === "id") {
    document.bindings.forEach((binding) => {
      if (getBindingMode(binding) === "live" && binding.query_id === previousId) {
        binding.query_id = value;
      }
    });
    return value;
  }

  return query.id;
}

export function applyQueryShape(
  document: DashboardDocument,
  queryId: string,
  params: QueryParamDef[],
  resultSchema: ResultSchemaField[],
): void {
  const query = document.query_defs.find((candidate) => candidate.id === queryId);
  if (!query) {
    return;
  }

  query.params = params;
  query.result_schema = resultSchema;

  document.bindings.forEach((binding) => {
    if (getBindingMode(binding) !== "live" || binding.query_id !== query.id) {
      return;
    }

    const view = document.dashboard_spec.views.find(
      (candidate) => candidate.id === binding.view_id,
    );
    if (!view) {
      return;
    }

    Object.assign(binding, reconcileBindingShape(binding, view, query));
  });
}
