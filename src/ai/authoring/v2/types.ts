import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardView,
  QueryDef,
} from "@/contracts";
import type { AuthoringToolName } from "@/ai/authoring/types";

export type AuthoringGoalStatus =
  | "active"
  | "awaiting_user"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed";

export type AuthoringDataModeV2 = "live" | "mock" | "undecided";

export interface ViewGoalV2 {
  summary?: string;
  dataMode?: AuthoringDataModeV2;
  chartType?: "line" | "bar" | "table" | "kpi" | "area" | "pie";
  metrics?: string[];
  dimensions?: string[];
  timeGrain?: "day" | "week" | "month";
  datasourceId?: string;
  table?: string;
}

export type TurnIntentV2 =
  | { kind: "chat" }
  | {
      kind: "explore_data";
      scope: "datasources" | "schema";
      datasourceId?: string;
      table?: string;
    }
  | { kind: "advise_analysis" }
  | { kind: "set_data_mode"; dataMode: Exclude<AuthoringDataModeV2, "undecided"> }
  | { kind: "create_view"; goal: ViewGoalV2 }
  | {
      kind: "approve_patch_text";
      decision: "approve" | "reject" | "revise";
    }
  | {
      kind: "approve_patch_event";
      proposalId: string;
      decision: "approve" | "reject";
      baseVersion: number;
    };

export interface AuthoringGoalV2 {
  id: string;
  kind: "create_view" | "revise_view" | "create_dashboard" | "repair_draft";
  status: AuthoringGoalStatus;
  summary: string;
  dataMode: AuthoringDataModeV2;
  chartPlan?: {
    chartType?: ViewGoalV2["chartType"];
    metrics?: string[];
    dimensions?: string[];
    timeGrain?: ViewGoalV2["timeGrain"];
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
  createdFromTurnId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStateV2 {
  activeGoal: AuthoringGoalV2 | null;
  pendingProposalId?: string;
  pendingProposalBaseVersion?: number;
}

export interface ContextStatusV2 {
  datasourcesLoaded: boolean;
  schemaLoadedFor?: {
    datasourceId: string;
    table?: string;
    fingerprint?: string;
    loadedAt: string;
  };
  chartSkillLoadedFor?: {
    chartType: NonNullable<ViewGoalV2["chartType"]>;
    referenceKey: string;
    version?: string;
    loadedAt: string;
  };
  dataFormatSkillLoadedFor?: {
    shape: "time_series" | "category_series" | "detail_rows" | "scalar_kpi";
    referenceKey: string;
    version?: string;
    loadedAt: string;
  };
}

export interface RuntimeCheckErrorV2 {
  code: string;
  message: string;
}

export interface ArtifactStatusV2 {
  expectedDataMode: AuthoringDataModeV2;
  observedDataMode?: "live" | "mock" | "mixed" | "none";
  dataModeConsistent: boolean;
  query: {
    required: boolean;
    exists: boolean;
    valid: boolean;
    issues: string[];
  };
  view: {
    required: boolean;
    exists: boolean;
    valid: boolean;
    missingRequiredSlots: string[];
    issues: string[];
  };
  binding: {
    required: boolean;
    exists: boolean;
    valid: boolean;
    missingSlots: string[];
    issues: string[];
  };
  layout: {
    required: boolean;
    existsDesktop: boolean;
    existsMobile: boolean;
    valid: boolean;
    issues: string[];
  };
  runtimeCheck: {
    required: boolean;
    status: "not_run" | "passed" | "failed" | "stale" | "not_applicable";
    errors: RuntimeCheckErrorV2[];
  };
  patch: {
    composed: boolean;
    stale: boolean;
    proposalId?: string;
  };
}

export type WorkflowActionV2 =
  | { kind: "answer"; reason: string }
  | { kind: "ask_user"; question: string; blocker: string }
  | { kind: "block_goal"; reason: string; blocker: string }
  | { kind: "reject_patch"; reason: string; proposalId: string }
  | { kind: "prepare_data_context"; tool: "getDatasources" | "getSchemaByDatasource" }
  | { kind: "prepare_query_context"; tool: "getSchemaByDatasource" }
  | {
      kind: "prepare_view_context";
      tool: "loadSkillReference";
      referenceKind: "chart" | "data_format";
    }
  | { kind: "stage_query"; tool: "upsertQuery" }
  | { kind: "stage_view"; tool: "upsertView" }
  | { kind: "stage_binding"; tool: "upsertBinding" }
  | { kind: "stage_layout"; tool: "upsertLayout" }
  | { kind: "run_check"; tool: "runCheck" }
  | { kind: "compose_patch"; tool: "composePatch" }
  | { kind: "await_approval" }
  | { kind: "apply_patch"; tool: "applyPatch" };

export type WorkflowToolExecutionV2 =
  | { status: "succeeded"; output: unknown }
  | {
      status: "failed";
      reason: "missing_result" | "tool_error" | "semantic_error" | "invalid_output";
      message: string;
      output?: unknown;
      error?: unknown;
    };

export interface ApprovalStateV2 {
  pendingProposalId?: string;
  pendingProposalBaseVersion?: number;
  userApproved: boolean;
  source: "none" | "text" | "ui_event";
}

export type ForcedToolStepV2 = {
  activeTools: AuthoringToolName[];
  toolChoice: "none" | { type: "tool"; toolName: AuthoringToolName };
};

export type CandidateArtifactsV2 = {
  dashboard: DashboardDocument;
  queries?: QueryDef[];
  views?: DashboardView[];
  bindings?: Binding[];
  layout?: {
    desktop?: DashboardLayoutItem;
    mobile?: DashboardLayoutItem;
  };
};
