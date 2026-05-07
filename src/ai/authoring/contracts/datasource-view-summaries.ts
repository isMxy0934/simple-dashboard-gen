import type {
  Binding,
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardView,
  QueryDef,
} from "@/contracts";
import type {
  RendererSlotSummary,
  RendererSummary,
} from "@/renderers/core/contracts";
import type { RendererValidationChecks } from "@/renderers/core/validation-result";

export interface DatasourceListItemSummary {
  datasource_id: string;
  label: string;
  description?: string;
}

export interface DatasourceListSummary {
  datasource_count: number;
  datasources: DatasourceListItemSummary[];
}

export interface AuthoringCheckSummary {
  status: "ok" | "warning" | "error";
  reason: string;
  counts: {
    ok: number;
    empty: number;
    error: number;
  };
  errors: AuthoringCheckFailure[];
}

export interface AuthoringCheckFailure {
  source: "contract" | "runtime" | "renderer";
  code: string;
  message: string;
  path?: string;
  view_id?: string;
  query_id?: string;
  binding_id?: string;
}

export interface ViewCheckSnapshot {
  view_id: string;
  status: "unknown" | "ok" | "empty" | "error" | "stale";
  reason: string;
  last_checked_at?: string;
  query_ids: string[];
  binding_ids: string[];
  runtime_summary?: AuthoringCheckSummary;
  renderer_checks?: Partial<RendererValidationChecks>;
}

export interface ViewListItem {
  id: string;
  title: string;
  description?: string;
  renderer_kind: DashboardRenderer["kind"];
  slot_summaries: RendererSlotSummary[];
  renderer_summary: RendererSummary;
  slot_count: number;
  has_query: boolean;
  has_binding: boolean;
  check_status: ViewCheckSnapshot["status"];
  check_reason?: string;
  last_checked_at?: string;
}

export interface QueryUsageRef {
  binding_id: string;
  view_id: string;
  slot_id: string;
}

export interface QueryDetail {
  query: QueryDef;
  used_by: QueryUsageRef[];
}

export interface BindingDetail {
  binding: Binding;
  slot?: DashboardRendererSlot;
  query?: QueryDef;
}

export interface ViewDetail {
  view: DashboardView;
  renderer_kind: DashboardRenderer["kind"];
  slot_summaries: RendererSlotSummary[];
  renderer_summary: RendererSummary;
  layout: {
    desktop?: DashboardLayoutItem | null;
    mobile?: DashboardLayoutItem | null;
  };
  bindings: BindingDetail[];
  query_ids: string[];
  latest_check?: ViewCheckSnapshot | null;
}

export function collectViewQueryIds(
  viewId: string,
  bindings: Binding[],
): string[] {
  return [...new Set(bindings.filter((binding) => binding.view_id === viewId)
    .map((binding) => binding.query_id)
    .filter((queryId): queryId is string => typeof queryId === "string"))];
}

export function buildBindingDetail(input: {
  binding: Binding;
  view?: DashboardView;
  query?: QueryDef;
}): BindingDetail {
  const slot = input.view?.renderer.slots.find(
    (candidate) => candidate.id === input.binding.slot_id,
  );

  return {
    binding: input.binding,
    slot,
    query: input.query,
  };
}
