import type {
  AuthoringChatRequestBody,
  AuthoringDataMode,
  AuthoringDataParts,
  AuthoringPatchApprovalPayload,
  AuthoringSkillSummary,
  AuthoringTools,
  AuthoringModeStageId,
  AuthoringModeSummary,
  AuthoringScopeResolution,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringChatSessionPayload,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";

export type AuthoringToolName = keyof AuthoringTools & string;

export type AuthoringToolChoice =
  | "auto"
  | "none"
  | { type: "tool"; toolName: AuthoringToolName };

export type AuthoringCapabilityProfile =
  | "chat"
  | "explore"
  | "author-dashboard"
  | "author-focused"
  | "approval";

export type AuthoringScope =
  | { kind: "dashboard" }
  | { kind: "focused"; viewId: string }
  | { kind: "empty" };

export interface AuthoringScopeCapabilities {
  profile: AuthoringCapabilityProfile;
  scope: AuthoringScope;
  scopeResolution: AuthoringScopeResolution;
  allowedTools: AuthoringToolName[];
  contextBlockVariant: "dashboard" | "focused" | "empty";
  relevantSkillIds: string[];
  stopReason: "approval-applied" | null;
}

export type {
  AuthoringChatRequestBody,
  AuthoringDataMode,
  AuthoringChatSessionPayload,
  AuthoringDataParts,
  AuthoringPatchApprovalPayload,
  AuthoringSkillSummary,
  AuthoringTools,
  AuthoringWorkingDraftSnapshot,
  AuthoringModeStageId,
  AuthoringModeSummary,
  AuthoringScopeResolution,
};
