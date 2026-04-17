import type {
  AuthoringChatRequestBody,
  AuthoringDataParts,
  AuthoringMessage,
  AuthoringPatchApprovalPayload,
  AuthoringSkillSummary,
  AuthoringTools,
  AuthoringWorkflowStage,
  AuthoringWorkflowSummary,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringChatSessionPayload,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session-state";

export type AuthoringToolName = keyof AuthoringTools & string;

export type AuthoringMode =
  | "chat"
  | "plan"
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
  activeTools: AuthoringToolName[];
  toolChoice: "auto" | "none";
  systemPromptSections: string[];
  contextBlockVariant: "dashboard" | "focused" | "empty";
  relevantSkillIds: string[];
  stopReason: "approval-applied" | null;
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
};
