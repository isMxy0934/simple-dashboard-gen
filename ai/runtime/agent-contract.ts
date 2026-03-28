import type { UIMessage } from "ai";
import type { DashboardDocument, DatasourceContext } from "../../contracts";
import type {
  AiSuggestion,
  LayoutDraftToolInput,
} from "../authoring/artifacts";
import type { AuthoringRouteDecision } from "./authoring-route";

export interface ContractStateSummary {
  dashboard_name: string;
  description?: string;
  views: Array<{
    id: string;
    title: string;
    has_binding: boolean;
    binding_mode?: "mock" | "live";
  }>;
  query_ids: string[];
  binding_count: number;
  missing_parts: string[];
  next_step: "layout" | "data" | "repair" | "review";
}

export interface DatasourceContextSummary {
  datasource_id: string | null;
  dialect: string | null;
  table_count: number;
  tables: Array<{
    name: string;
    field_count: number;
    sample_fields: Array<{
      name: string;
      type: string;
      semantic_type?: string;
    }>;
  }>;
}

export interface RuntimeCheckSummary {
  status: "ok" | "warning" | "error";
  reason: string;
  counts: {
    ok: number;
    empty: number;
    error: number;
  };
  errors: Array<{
    view_id: string;
    query_id: string;
    code?: string;
    message?: string;
  }>;
}

export interface ProposalApprovalSummary {
  required: true;
  status: "pending";
  summary: string;
  operation_count: number;
  affected_paths: string[];
}

export interface ProposalRepairSummary {
  status: "not-needed" | "repaired" | "failed";
  attempted: number;
  max_attempts: number;
  repaired: boolean;
  notes: string[];
}

export interface AgentDraftOutput {
  suggestion: AiSuggestion;
  approval: ProposalApprovalSummary;
  runtime_check?: RuntimeCheckSummary;
  repair: ProposalRepairSummary;
}

export type DraftViewsToolInput = LayoutDraftToolInput;

export interface DraftViewsToolOutput {
  summary: string;
  dashboard_name?: string;
  view_count: number;
  view_ids: string[];
  next_step: "draftQueryDefs" | "draftBindings" | "composePatch";
}

export interface DraftQueryDefsToolInput {
  request: string;
  view_ids?: string[];
}

export interface DraftQueryDefsToolOutput {
  summary: string;
  query_count: number;
  query_ids: string[];
  next_step: "draftBindings" | "composePatch";
}

export interface DraftBindingsToolInput {
  request: string;
  view_ids?: string[];
  query_ids?: string[];
  binding_mode?: "mock" | "live";
}

export interface DraftBindingsToolOutput {
  summary: string;
  binding_count: number;
  binding_ids: string[];
  binding_mode: "mock" | "live";
  next_step: "composePatch";
}

export interface ComposePatchToolInput {
  reason?: string;
}

export interface ApplyPatchToolInput {
  suggestion_id?: string;
}

export interface ApplyPatchToolOutput {
  applied: true;
  suggestion_id: string;
  kind: AiSuggestion["kind"];
  title: string;
  summary: string;
  patch_summary: string;
  /** Omitted after client prune; present when tool first completes. */
  dashboard?: DashboardDocument;
}

export interface AuthoringWorkflowStage {
  id: ContractStateSummary["next_step"];
  title: string;
  description: string;
  status: "complete" | "active" | "pending";
}

export interface AuthoringWorkflowSummary {
  route: AuthoringRouteDecision["route"];
  mode: "inspection" | "authoring";
  next_step: ContractStateSummary["next_step"];
  active_stage: AuthoringWorkflowStage["id"];
  summary: string;
  active_tools: string[];
  skill_ids: string[];
  approval_required: boolean;
  stages: AuthoringWorkflowStage[];
}

/** Stripped before model calls; see `authoring-agent-client-parts`. */
export interface AuthoringUiPatchApprovalPayload {
  approvalId: string;
  suggestionId: string | null;
}

/** Data parts produced for UI / routing; included in agent request handling as needed. */
export interface AuthoringAgentModelDataParts {
  authoring_route: AuthoringRouteDecision;
  authoring_workflow: AuthoringWorkflowSummary;
}

/** Data parts never sent to the model; keys listed in `AUTHORING_AGENT_CLIENT_ONLY_DATA_KEYS`. */
export interface AuthoringAgentClientOnlyDataParts {
  authoring_ui_patch_approval: AuthoringUiPatchApprovalPayload;
}

export interface AuthoringAgentDataParts
  extends Record<string, unknown>,
    AuthoringAgentModelDataParts,
    AuthoringAgentClientOnlyDataParts {}

export interface AuthoringAgentTools
  extends Record<string, { input: unknown; output: unknown }> {
  inspectContractState: {
    input: {
      reason?: string;
    };
    output: ContractStateSummary;
  };
  inspectDatasourceContext: {
    input: {
      reason?: string;
    };
    output: DatasourceContextSummary;
  };
  draftViews: {
    input: DraftViewsToolInput;
    output: DraftViewsToolOutput;
  };
  draftQueryDefs: {
    input: DraftQueryDefsToolInput;
    output: DraftQueryDefsToolOutput;
  };
  draftBindings: {
    input: DraftBindingsToolInput;
    output: DraftBindingsToolOutput;
  };
  composePatch: {
    input: ComposePatchToolInput;
    output: AgentDraftOutput;
  };
  applyPatch: {
    input: ApplyPatchToolInput;
    output: ApplyPatchToolOutput;
  };
  runRuntimeCheck: {
    input: {
      reason?: string;
    };
    output: RuntimeCheckSummary;
  };
}

export type AuthoringAgentMessage = UIMessage<
  unknown,
  AuthoringAgentDataParts,
  AuthoringAgentTools
>;

export interface AgentChatRequestBody {
  id?: string;
  messages: AuthoringAgentMessage[];
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
}
