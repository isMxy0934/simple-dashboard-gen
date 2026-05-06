export type AuthoringDataMode = "live" | "mock" | "undecided";

export interface ViewGoal {
  summary?: string;
  dataMode?: AuthoringDataMode;
  chartSkillId?: string;
  requestedChartLabel?: string;
  metrics?: string[];
  dimensions?: string[];
  timeGrain?: "day" | "week" | "month";
  datasourceId?: string;
  table?: string;
  targetViewId?: string;
  targetViewTitle?: string;
}

export interface AuthoringGoal {
  id: string;
  kind: "create_view" | "revise_view" | "create_dashboard";
  status: "active" | "awaiting_user" | "awaiting_approval" | "blocked" | "completed" | "failed";
  summary: string;
  dataMode: AuthoringDataMode;
  chartPlan?: {
    chartSkillId?: string;
    requestedChartLabel?: string;
    metrics?: string[];
    dimensions?: string[];
    timeGrain?: ViewGoal["timeGrain"];
  };
  targetRefs: {
    datasourceId?: string;
    table?: string;
    queryId?: string;
    viewId?: string;
    bindingIds?: string[];
    layoutId?: string;
  };
  blockers: Array<{
    kind: string;
    message: string;
  }>;
}

export interface ContextStatus {
  datasourcesLoaded: boolean;
  availableChartSkillIds: string[];
  schemaLoadedFor?: {
    datasourceId: string;
    table?: string;
    fingerprint?: string;
    loadedAt: string;
  };
  chartSkillLoadedFor?: {
    skillId: NonNullable<ViewGoal["chartSkillId"]>;
    version?: string;
    loadedAt: string;
  };
}
