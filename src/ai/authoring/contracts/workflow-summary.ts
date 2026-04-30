import type {
  AuthoringDataMode,
  AuthoringDraftOutput,
  AuthoringIntent,
  DraftStatusLayoutCoverage,
  DraftStatusToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import type {
  DatasourceListSummary,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/datasource-view-summaries";

export interface AuthoringScopeResolution {
  effective_scope: "dashboard" | "focused";
  selected_view_id: string | null;
  scope_reason:
    | "no_selection"
    | "selected_view"
    | "invalid_selection"
    | "blocked_dashboard_request";
  requires_scope_clarification: boolean;
}

export interface AuthoringContextEnvelope {
  user_intent: {
    latest_user_text?: string | null;
    declared_intent?: AuthoringIntent | null;
  };
  scope_resolution: AuthoringScopeResolution;
  workflow?: {
    active_goal: {
      id: string;
      kind: string;
      status: string;
      summary: string;
      data_mode: AuthoringDataMode;
      chart_skill_id?: string | null;
      requested_chart_label?: string | null;
      target_refs: Record<string, unknown>;
      blockers: Array<{ kind: string; message: string }>;
    } | null;
    pending_proposal_id?: string | null;
    pending_proposal_base_version?: number | null;
    pending_proposal_draft_fingerprint?: string | null;
  } | null;
  draft: {
    document_hash: string;
    data_mode: AuthoringDataMode;
    dirty_view_ids: string[];
    dirty_query_ids: string[];
    dirty_binding_ids: string[];
    layout_coverage: DraftStatusLayoutCoverage[];
    unplaced_view_ids: string[];
    last_check_hash?: string | null;
    check_fresh: boolean;
    can_compose: boolean;
    blockers: DraftStatusToolOutput["blockers"];
    artifact_status?: unknown;
  };
  pending_approval: {
    proposal_id?: string | null;
    summary?: string | null;
    operation_count?: number | null;
  } | null;
  save_publish: {
    local_draft_dirty: boolean;
    cloud_draft_saved: boolean;
    published: boolean;
  };
  datasources: DatasourceListSummary;
}

export interface AuthoringWorkflowStage {
  id: "chat" | "explore" | "author" | "approval";
  title: string;
  description: string;
  status: "complete" | "active" | "pending";
}

export interface AuthoringWorkflowSummary {
  route: "approval" | "chat" | "authoring";
  mode:
    | "chat"
    | "explore"
    | "author-dashboard"
    | "author-focused"
    | "approval";
  active_stage: AuthoringWorkflowStage["id"];
  summary: string;
  active_tools: string[];
  skill_ids: string[];
  approval_required: boolean;
  stages: AuthoringWorkflowStage[];
}

export interface AuthoringPatchApprovalPayload {
  approvalId: string;
  suggestionId: string | null;
}

export interface AuthoringDataParts extends Record<string, unknown> {
  authoring_scope?: {
    profile:
      | "chat"
      | "explore"
      | "author-dashboard"
      | "author-focused"
      | "approval";
    scope:
      | { kind: "dashboard" }
      | { kind: "focused"; viewId: string }
      | { kind: "empty" };
    scopeResolution?: AuthoringScopeResolution;
    allowedTools: string[];
    contextFingerprint?: string | null;
    stopReason?: "approval-applied" | null;
  };
  authoring_patch?: AuthoringDraftOutput;
  authoring_checks?: ViewCheckSnapshot[];
  authoring_patch_approval?: AuthoringPatchApprovalPayload;
}
