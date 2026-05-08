import { isLiveBinding, reconcileBindingShape } from "../../../domain/dashboard/bindings";
import {
  getQueryById,
  getViewById,
  upsertBindingInDocument,
  upsertQueryInDocument,
} from "../../../domain/dashboard/document";
import type {
  DashboardDocument,
  QueryDef,
  QueryParamDef,
  QueryOutput,
} from "../../../contracts";

export function addBlankQueryToDashboard(
  document: DashboardDocument,
  viewId: string,
  datasourceId: string,
): { document: DashboardDocument; queryId: string | null } {
  const view = getViewById(document, viewId);
  if (!view) {
    return { document, queryId: null };
  }

  const seed = document.query_defs.length + 1;
  const query = createBlankQuery(seed, view, datasourceId);
  return {
    document: upsertQueryInDocument(document, query),
    queryId: query.id,
  };
}

export function updateQueryMeta(
  document: DashboardDocument,
  queryId: string,
  field: "id" | "name" | "datasource_id" | "sql_template",
  value: string,
): { document: DashboardDocument; queryId: string; error?: string } {
  const query = getQueryById(document, queryId);
  if (!query) {
    return { document, queryId };
  }

  const nextValue = field === "id" ? value.trim() : value;
  if (field === "id") {
    if (!nextValue) {
      return {
        document,
        queryId,
        error: "Query id is required.",
      };
    }
    if (
      document.query_defs.some(
        (candidate) => candidate.id === nextValue && candidate.id !== query.id,
      )
    ) {
      return {
        document,
        queryId,
        error: `Query id "${nextValue}" already exists.`,
      };
    }
  }

  const nextQuery = {
    ...query,
    [field]: nextValue,
  };
  const nextDocument = upsertQueryInDocument(document, nextQuery, {
    previousQueryId: field === "id" ? query.id : undefined,
  });

  return {
    document: nextDocument,
    queryId: nextQuery.id,
  };
}

export function applyQueryShape(
  document: DashboardDocument,
  queryId: string,
  params: QueryParamDef[],
  output: QueryOutput,
): DashboardDocument {
  const query = getQueryById(document, queryId);
  if (!query) {
    return document;
  }

  const nextQuery = {
    ...query,
    params,
    output,
  };
  let nextDocument = upsertQueryInDocument(document, nextQuery);

  nextDocument.bindings.forEach((binding) => {
    if (!isLiveBinding(binding) || binding.query_id !== nextQuery.id) {
      return;
    }

    const view = getViewById(nextDocument, binding.view_id);
    if (!view) {
      return;
    }

    nextDocument = upsertBindingInDocument(
      nextDocument,
      reconcileBindingShape(binding, view, nextQuery),
    );
  });

  return nextDocument;
}

function createBlankQuery(
  seed: number,
  view: DashboardDocument["dashboard_spec"]["views"][number],
  datasourceId: string,
): QueryDef {
  return {
    id: `q_custom_${seed}`,
    name: `${view.title} Query`,
    datasource_id: datasourceId,
    sql_template: "select 0 as value",
    params: [],
    output: {
      kind: "rows",
      schema: [{ name: "value", type: "number", nullable: false }],
    },
  };
}
