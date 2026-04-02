import type { DashboardDocument, DatasourceContext } from "@/contracts";
import { getBindingMode } from "@/domain/dashboard/bindings";
import type {
  DatasourceContextSummary,
  ViewCheckSnapshot,
  ViewListItem,
} from "@/agent/dashboard-agent/contracts/agent-contract";

export interface DashboardContractStateSummary {
  dashboard_name: string;
  description?: string;
  views: Array<{
    id: string;
    title: string;
    has_binding: boolean;
    binding_mode?: "live" | "mock";
  }>;
  query_ids: string[];
  binding_count: number;
  missing_parts: string[];
  next_step: "read" | "write" | "approval";
}

export function summarizeContractState(
  document: DashboardDocument,
): DashboardContractStateSummary {
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

export function buildViewListSummary(input: {
  document: DashboardDocument;
  checks?: ViewCheckSnapshot[] | null;
  dashboardId?: string | null;
}): {
  dashboard_name: string;
  dashboard_id: string | null;
  view_count: number;
  views: ViewListItem[];
} {
  const checksByViewId = new Map(
    (input.checks ?? []).map((check) => [check.view_id, check]),
  );

  return {
    dashboard_name: input.document.dashboard_spec.dashboard.name,
    dashboard_id: input.dashboardId ?? null,
    view_count: input.document.dashboard_spec.views.length,
    views: input.document.dashboard_spec.views.map((view) => {
      const check = checksByViewId.get(view.id);

      return {
        id: view.id,
        title: view.title,
        description: view.description,
        slot_count: view.renderer.slots.length,
        has_query: input.document.bindings.some(
          (binding) =>
            binding.view_id === view.id && typeof binding.query_id === "string",
        ),
        has_binding: input.document.bindings.some(
          (binding) => binding.view_id === view.id,
        ),
        check_status: check?.status ?? "unknown",
        check_reason: check?.reason,
        last_checked_at: check?.last_checked_at,
      };
    }),
  };
}

function inferNextStep(
  document: DashboardDocument,
  missingParts: string[],
): DashboardContractStateSummary["next_step"] {
  if (
    missingParts.includes("views") ||
    missingParts.includes("desktop_layout") ||
    missingParts.includes("query_defs") ||
    missingParts.includes("bindings")
  ) {
    return "write";
  }

  const hasUnboundView = document.dashboard_spec.views.some(
    (view) => !document.bindings.some((binding) => binding.view_id === view.id),
  );

  if (hasUnboundView) {
    return "write";
  }

  return "approval";
}
