import type { DashboardDocument } from "./dashboard";

export interface WorkspaceMember {
  user_id: string;
  workspace_id: string;
  name: string;
  email?: string;
}

export interface WorkspaceUserSettings {
  workspace_id: string;
  user_id: string;
  verbose: boolean;
  updated_at: string;
}

export interface EditingPresenceEntry {
  workspace_id: string;
  dashboard_id: string;
  user_id: string;
  user_name: string;
  session_id: string;
  last_seen_at: string;
  last_saved_at?: string | null;
  is_active: boolean;
}

export interface DashboardWorkerState {
  memorySummary: string;
  recentTurns: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
  lastRunAt?: string | null;
}

export interface ViewWorkerState {
  viewId: string;
  memorySummary: string;
  recentTurns: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
  lastRunAt?: string | null;
}

export interface MainAgentApprovalState {
  pending: boolean;
  lastSuggestionId?: string | null;
}

export interface MainAgentSessionPayload {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  focusViewId: string | null;
  baseVersion: number;
  dirty: boolean;
  stale: boolean;
  canonicalDraft: DashboardDocument;
  dashboardWorkerState: DashboardWorkerState;
  viewWorkerStatesByViewId: Record<string, ViewWorkerState>;
  approvalState: MainAgentApprovalState;
  updatedAt: string;
}

export interface OpenSessionRequest {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
}

export interface SaveSessionRequest {
  payload: MainAgentSessionPayload;
}

export interface OpenSessionResponse {
  headVersion: number;
  restoredFromSession: boolean;
  stale: boolean;
  presence: EditingPresenceEntry[];
  sessionPayload: MainAgentSessionPayload;
}

export interface CloudSaveDraftRequest {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  baseVersion: number;
  force?: boolean;
  draft: DashboardDocument;
}

export interface CloudPublishRequest {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  draftVersion: number;
}

export interface WorkspaceContextPayload {
  workspace_id: string;
  workspace_name: string;
  users: WorkspaceMember[];
}
