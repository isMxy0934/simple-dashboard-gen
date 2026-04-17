import type {
  Binding,
  DashboardDocument,
  DashboardRenderer,
  DatasourceContext,
  QueryDef,
} from "@/contracts";
import type { MainAgentWorkingDraftSnapshot } from "@/ai/authoring/contracts/session-state";

export interface WorkingDraftState {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
  dirtyViewIds: Set<string>;
  dirtyQueryIds: Set<string>;
  dirtyBindingIds: Set<string>;
  layoutTouched: boolean;
  stagedAt: string | null;
}

export function createWorkingDraftState(
  snapshot?: MainAgentWorkingDraftSnapshot | null,
): WorkingDraftState {
  return {
    ...(snapshot?.dashboardSpec
      ? { dashboardSpec: cloneDashboardSpec(snapshot.dashboardSpec) }
      : {}),
    ...(snapshot?.queryDefs
      ? { queryDefs: snapshot.queryDefs.map(cloneQuery) }
      : {}),
    ...(snapshot?.bindings
      ? { bindings: snapshot.bindings.map(cloneBinding) }
      : {}),
    ...(snapshot?.bindingMode ? { bindingMode: snapshot.bindingMode } : {}),
    dirtyViewIds: new Set(snapshot?.dirtyViewIds ?? []),
    dirtyQueryIds: new Set(snapshot?.dirtyQueryIds ?? []),
    dirtyBindingIds: new Set(snapshot?.dirtyBindingIds ?? []),
    layoutTouched: snapshot?.layoutTouched ?? false,
    stagedAt: snapshot?.stagedAt ?? null,
  };
}

export function cloneDashboardSpec(
  dashboardSpec: DashboardDocument["dashboard_spec"],
): DashboardDocument["dashboard_spec"] {
  return JSON.parse(JSON.stringify(dashboardSpec)) as DashboardDocument["dashboard_spec"];
}

export function cloneRenderer(renderer: DashboardRenderer): DashboardRenderer {
  return JSON.parse(JSON.stringify(renderer)) as DashboardRenderer;
}

export function cloneDatasourceSchema(
  datasourceSchema: DatasourceContext,
): DatasourceContext {
  return JSON.parse(JSON.stringify(datasourceSchema)) as DatasourceContext;
}

export function cloneQuery(query: QueryDef): QueryDef {
  return JSON.parse(JSON.stringify(query)) as QueryDef;
}

export function cloneBinding(binding: Binding): Binding {
  return JSON.parse(JSON.stringify(binding)) as Binding;
}
