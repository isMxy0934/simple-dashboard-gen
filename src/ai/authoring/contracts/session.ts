import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Binding, DashboardDocument, QueryDef } from "@/contracts";

export const AUTHORING_CHAT_SESSION_PAYLOAD_VERSION = 6 as const;

export interface AuthoringWorkingDraftArtifactOwner {
  goalId: string;
  artifactKind: "query" | "view" | "binding" | "layout";
  artifactId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringWorkingDraftOwnership {
  byArtifactId: Record<string, AuthoringWorkingDraftArtifactOwner>;
  byGoalId: Record<string, string[]>;
  currentByGoal: Record<
    string,
    {
      queryId?: string;
      viewId?: string;
      bindingIds?: string[];
      layoutId?: string;
    }
  >;
}

export interface AuthoringWorkingDraftSnapshot {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
  dirtyViewIds: string[];
  dirtyQueryIds: string[];
  dirtyBindingIds: string[];
  layoutTouched: boolean;
  ownership?: AuthoringWorkingDraftOwnership;
  stagedAt: string;
}

export interface AuthoringRunCheckStateSnapshot {
  fingerprint: string;
  signatures: string[];
  consecutiveRepeatCount: number;
}

export interface AuthoringChatSessionState {
  sessionId: string;
  dashboardId: string | null;
  messages: AgentMessage[];
  prompt: {
    lastContextFingerprint: string | null;
    workingDraft: AuthoringWorkingDraftSnapshot | null;
    lastRunCheckState: AuthoringRunCheckStateSnapshot | null;
    rejectedProposalIds?: string[];
  };
}

export interface AuthoringChatSessionPayload extends AuthoringChatSessionState {
  version: typeof AUTHORING_CHAT_SESSION_PAYLOAD_VERSION;
  updatedAt: string;
}
