import type {
  Binding,
  DashboardDocument,
  DashboardRenderer,
  DatasourceContext,
  QueryDef,
} from "@/contracts";
import type {
  AuthoringWorkingDraftArtifactOwner,
  AuthoringWorkingDraftOwnership,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";

export interface WorkingDraftState {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
  dirtyViewIds: Set<string>;
  dirtyQueryIds: Set<string>;
  dirtyBindingIds: Set<string>;
  layoutTouched: boolean;
  ownership: AuthoringWorkingDraftOwnership;
  stagedAt: string | null;
}

export function createEmptyWorkingDraftOwnership(): AuthoringWorkingDraftOwnership {
  return {
    byArtifactId: {},
    byGoalId: {},
    currentByGoal: {},
  };
}

export function cloneWorkingDraftOwnership(
  ownership: AuthoringWorkingDraftOwnership | null | undefined,
): AuthoringWorkingDraftOwnership {
  return ownership
    ? JSON.parse(JSON.stringify(ownership)) as AuthoringWorkingDraftOwnership
    : createEmptyWorkingDraftOwnership();
}

export function markWorkingDraftArtifactOwner(input: {
  workingDraft: WorkingDraftState;
  goalId?: string | null;
  artifactKind: AuthoringWorkingDraftArtifactOwner["artifactKind"];
  artifactId: string;
  timestamp?: string;
}) {
  const goalId = input.goalId?.trim();
  if (!goalId) {
    return;
  }

  const timestamp = input.timestamp ?? new Date().toISOString();
  const owner: AuthoringWorkingDraftArtifactOwner = {
    goalId,
    artifactKind: input.artifactKind,
    artifactId: input.artifactId,
    createdAt:
      input.workingDraft.ownership.byArtifactId[input.artifactId]?.createdAt ??
      timestamp,
    updatedAt: timestamp,
  };

  input.workingDraft.ownership.byArtifactId[input.artifactId] = owner;
  input.workingDraft.ownership.byGoalId[goalId] = [
    ...new Set([
      ...(input.workingDraft.ownership.byGoalId[goalId] ?? []),
      input.artifactId,
    ]),
  ];

  const current = input.workingDraft.ownership.currentByGoal[goalId] ?? {};
  if (input.artifactKind === "query") {
    current.queryId = input.artifactId;
  } else if (input.artifactKind === "view") {
    current.viewId = input.artifactId;
  } else if (input.artifactKind === "binding") {
    current.bindingIds = [
      ...new Set([...(current.bindingIds ?? []), input.artifactId]),
    ];
  } else {
    current.layoutId = input.artifactId;
  }
  input.workingDraft.ownership.currentByGoal[goalId] = current;
}

export function createWorkingDraftState(
  snapshot?: AuthoringWorkingDraftSnapshot | null,
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
    ownership: cloneWorkingDraftOwnership(snapshot?.ownership),
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
