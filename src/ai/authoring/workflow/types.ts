import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardView,
  QueryDef,
} from "@/contracts";
import type {
  AuthoringScope,
  AuthoringToolName,
} from "@/ai/authoring/contracts/runtime";

export type AuthoringGoalStatus =
  | "active"
  | "awaiting_user"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed";

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

export interface DashboardGoal {
  summary?: string;
  dataMode?: AuthoringDataMode;
  chartSkillId?: string;
  requestedChartLabel?: string;
  datasourceId?: string;
  table?: string;
  views: ViewGoal[];
}

export type TurnIntent =
  | { kind: "set_data_mode"; dataMode: Exclude<AuthoringDataMode, "undecided"> }
  | { kind: "create_view"; goal: ViewGoal }
  | { kind: "revise_view"; goal: ViewGoal }
  | { kind: "create_dashboard"; goal: DashboardGoal }
  | {
      kind: "approve_patch_event";
      proposalId: string;
      decision: "approve" | "reject";
      baseVersion: number;
    };

export interface AuthoringGoal {
  id: string;
  kind: "create_view" | "revise_view" | "create_dashboard";
  status: AuthoringGoalStatus;
  parentGoalId?: string;
  childGoalIds?: string[];
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
  contextRefs?: {
    schemaFingerprint?: string;
    chartSkillVersion?: string;
  };
  blockers: Array<{
    kind: string;
    message: string;
  }>;
  createdFromTurnId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringWorkflowState {
  goals: AuthoringGoal[];
  activeGoalId: string | null;
  pendingProposalId?: string;
  pendingProposalBaseVersion?: number;
  pendingProposalDraftFingerprint?: string;
}

export interface ToolAvailability {
  scopedTools: readonly AuthoringToolName[];
  scope: AuthoringScope;
  intent: TurnIntent | null;
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

export interface RuntimeCheckError {
  code: string;
  message: string;
}

export interface ArtifactStatus {
  expectedDataMode: AuthoringDataMode;
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
    errors: RuntimeCheckError[];
  };
  patch: {
    composed: boolean;
    stale: boolean;
    proposalId?: string;
  };
}

export type WorkflowAction =
  | { kind: "answer"; reason: string }
  | { kind: "complete_goal"; reason: string }
  | { kind: "ask_user"; question: string; blocker: string }
  | { kind: "block_goal"; reason: string; blocker: string }
  | { kind: "reject_patch"; reason: string; proposalId: string }
  | { kind: "inspect_view"; tool: "getView" }
  | { kind: "prepare_data_context"; tool: "getDatasources" | "getSchemaByDatasource" }
  | { kind: "prepare_query_context"; tool: "getSchemaByDatasource" }
  | { kind: "prepare_view_context"; tool: "loadSkill" }
  | { kind: "stage_query"; tool: "upsertQuery" }
  | { kind: "stage_view"; tool: "upsertView" }
  | { kind: "stage_binding"; tool: "upsertBinding" }
  | { kind: "stage_layout"; tool: "upsertLayout" }
  | { kind: "run_check"; tool: "runCheck" }
  | { kind: "compose_patch"; tool: "composePatch" }
  | { kind: "await_approval" }
  | { kind: "apply_patch"; tool: "applyPatch" };

export type WorkflowToolExecution =
  | { status: "succeeded"; output: unknown }
  | {
      status: "failed";
      reason: "missing_result" | "tool_error" | "semantic_error" | "invalid_output";
      message: string;
      output?: unknown;
      error?: unknown;
    };

export interface ApprovalState {
  pendingProposalId?: string;
  pendingProposalBaseVersion?: number;
  userApproved: boolean;
  source: "none" | "ui_event";
}

export type ToolStepMode = "forced" | "terminal";

export type ToolStep = {
  mode: ToolStepMode;
  activeTools: AuthoringToolName[];
  toolChoice: "auto" | "none" | { type: "tool"; toolName: AuthoringToolName };
};

export type CandidateArtifacts = {
  dashboard: DashboardDocument;
  queries?: QueryDef[];
  views?: DashboardView[];
  bindings?: Binding[];
  layout?: {
    desktop?: DashboardLayoutItem;
    mobile?: DashboardLayoutItem;
  };
};
