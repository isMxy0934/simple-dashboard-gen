import type { DashboardDocument } from "@/contracts";
import { getBindingMode } from "@/domain/dashboard/bindings";
import type {
  DatasourceListItemSummary,
  ViewCheckSnapshot,
  ViewListItem,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import { summarizeEChartsRenderer } from "@/renderers/echarts/summary";
import { summarizeRendererValidationChecks } from "@/renderers/core/validation-result";

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
  };
}

export function summarizeDatasourceList(
  datasources?: DatasourceListItemSummary[] | null,
) {
  return {
    datasource_count: datasources?.length ?? 0,
    datasources: datasources ?? [],
  };
}

export function buildDashboardPromptSummary(input: {
  document: DashboardDocument;
  dashboardId?: string | null;
}) {
  return {
    dashboard_name: input.document.dashboard_spec.dashboard.name,
    dashboard_id: input.dashboardId ?? null,
    view_count: input.document.dashboard_spec.views.length,
    query_count: input.document.query_defs.length,
    binding_count: input.document.bindings.length,
  };
}

export function buildPromptViewStateSummary(input: {
  document: DashboardDocument;
  checks?: ViewCheckSnapshot[] | null;
  dashboardId?: string | null;
}) {
  const summary = buildViewListSummary(input);

  return {
    view_count: summary.view_count,
    views: summary.views.map((view) => ({
      id: view.id,
      title: view.title,
      renderer_kind: view.renderer_kind,
      check_status: view.check_status,
      has_query: view.has_query,
      has_binding: view.has_binding,
      slot_count: view.slot_count,
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
      const rendererSummary = summarizeEChartsRenderer(view.renderer);
      const rendererStatus = summarizeRendererValidationChecks(check?.renderer_checks);

      return {
        id: view.id,
        title: view.title,
        description: view.description,
        renderer_kind: view.renderer.kind,
        slot_summaries: rendererSummary.slot_summaries,
        renderer_summary: rendererSummary,
        slot_count: view.renderer.slots.length,
        has_query: input.document.bindings.some(
          (binding) =>
            binding.view_id === view.id && typeof binding.query_id === "string",
        ),
        has_binding: input.document.bindings.some(
          (binding) => binding.view_id === view.id,
        ),
        check_status: check?.status ?? "unknown",
        check_reason:
          check?.reason ??
          (rendererStatus.status === "unknown" ? undefined : rendererStatus.reason),
        last_checked_at: check?.last_checked_at,
      };
    }),
  };
}
