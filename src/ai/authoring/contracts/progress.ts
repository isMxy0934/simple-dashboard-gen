import type {
  AuthoringDataMode,
  DeclareViewGoalInput,
} from "@/ai/authoring/contracts/tool-io";

export type { AuthoringDataMode };

export type ViewGoal = DeclareViewGoalInput;

export interface AuthoringGoal {
  id: string;
  kind: "create_view" | "revise_view" | "create_dashboard";
  status: "active" | "awaiting_user" | "awaiting_approval" | "blocked" | "completed" | "failed";
  summary: string;
  dataMode: AuthoringDataMode;
  viewPlan?: {
    viewKind?: ViewGoal["viewKind"];
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
  availableViewKinds: string[];
  schemaLoadedFor?: {
    datasourceId: string;
    table?: string;
    fingerprint?: string;
    loadedAt: string;
  };
  semanticSkillLoadedFor?: {
    viewKind: NonNullable<ViewGoal["viewKind"]>;
    skillId: string;
    version?: string;
    loadedAt: string;
  };
}
