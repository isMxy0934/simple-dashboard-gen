import type {
  AuthoringChatRequestBody,
  AuthoringDataParts,
  AuthoringMessage,
  AuthoringPatchApprovalPayload,
  AuthoringSkillSummary,
  AuthoringTools,
  AuthoringWorkflowStage,
  AuthoringWorkflowSummary,
  AuthoringNextAction,
  AuthoringLifecyclePhase,
  AuthoringScopeResolution,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringChatSessionPayload,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session-state";

export type AuthoringToolName = keyof AuthoringTools & string;

export type AuthoringToolChoice =
  | "auto"
  | "none"
  | { type: "tool"; toolName: AuthoringToolName };

export type AuthoringMode =
  | "chat"
  | "explore"
  | "author-dashboard"
  | "author-focused"
  | "approval";

export type AuthoringScope =
  | { kind: "dashboard" }
  | { kind: "focused"; viewId: string }
  | { kind: "empty" };

export interface AuthoringScopeDecision {
  mode: AuthoringMode;
  scope: AuthoringScope;
  scopeResolution: AuthoringScopeResolution;
  activeTools: AuthoringToolName[];
  toolChoice: AuthoringToolChoice;
  systemPromptSections: string[];
  contextBlockVariant: "dashboard" | "focused" | "empty";
  relevantSkillIds: string[];
  stopReason: "approval-applied" | null;
}

export interface AuthoringLifecycleDecision {
  phase: AuthoringLifecyclePhase;
  nextAction: AuthoringNextAction;
  activeTools: AuthoringToolName[];
  toolChoice: AuthoringToolChoice;
  reason: string;
}

export type {
  AuthoringChatRequestBody,
  AuthoringChatSessionPayload,
  AuthoringDataParts,
  AuthoringMessage,
  AuthoringPatchApprovalPayload,
  AuthoringSkillSummary,
  AuthoringTools,
  AuthoringWorkingDraftSnapshot,
  AuthoringWorkflowStage,
  AuthoringWorkflowSummary,
  AuthoringNextAction,
  AuthoringLifecyclePhase,
  AuthoringScopeResolution,
};
