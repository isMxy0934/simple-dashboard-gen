import type {
  DashboardDocument,
  DatasourceContext,
} from "../../contracts";
import { getBindingMode } from "../../domain/dashboard/bindings";
import type {
  ContractStateSummary,
  DatasourceContextSummary,
} from "../runtime/agent-contract";

export function summarizeContractState(
  document: DashboardDocument,
): ContractStateSummary {
  const views = document.dashboard_spec.views.map((view) => {
    const bindingMode = getBindingMode(
      document.bindings.find((binding) => binding.view_id === view.id),
    );

    return {
      id: view.id,
      title: view.title,
      has_binding: document.bindings.some((binding) => binding.view_id === view.id),
      binding_mode: bindingMode === "unbound" ? undefined : bindingMode,
    };
  });
  const missingParts: string[] = [];

  if (views.length === 0) {
    missingParts.push("views");
  }

  if ((document.dashboard_spec.layout.desktop?.items.length ?? 0) === 0) {
    missingParts.push("desktop_layout");
  }

  if (document.query_defs.length === 0) {
    missingParts.push("query_defs");
  }

  if (document.bindings.length === 0) {
    missingParts.push("bindings");
  }

  return {
    dashboard_name: document.dashboard_spec.dashboard.name,
    description: document.dashboard_spec.dashboard.description,
    views,
    query_ids: document.query_defs.map((query) => query.id),
    binding_count: document.bindings.length,
    missing_parts: missingParts,
    next_step: inferNextStep(document, missingParts),
  };
}

export function summarizeDatasourceContext(
  datasourceContext?: DatasourceContext | null,
): DatasourceContextSummary {
  if (!datasourceContext) {
    return {
      datasource_id: null,
      dialect: null,
      table_count: 0,
      tables: [],
    };
  }

  return {
    datasource_id: datasourceContext.datasource_id,
    dialect: datasourceContext.dialect,
    table_count: datasourceContext.tables.length,
    tables: datasourceContext.tables.map((table) => ({
      name: table.name,
      field_count: table.fields.length,
      sample_fields: table.fields.slice(0, 6).map((field) => ({
        name: field.name,
        type: field.type,
        semantic_type: field.semantic_type,
      })),
    })),
  };
}

function inferNextStep(
  document: DashboardDocument,
  missingParts: string[],
): ContractStateSummary["next_step"] {
  if (
    missingParts.includes("views") ||
    missingParts.includes("desktop_layout")
  ) {
    return "layout";
  }

  if (
    missingParts.includes("query_defs") ||
    missingParts.includes("bindings")
  ) {
    return "data";
  }

  const hasUnboundView = document.dashboard_spec.views.some(
    (view) => !document.bindings.some((binding) => binding.view_id === view.id),
  );

  if (hasUnboundView) {
    return "repair";
  }

  return "review";
}
