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

export interface AuthoringRuntimeState {
  memorySummary: string;
  recentTurns: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
  lastRunAt?: string | null;
}

export interface FocusedViewRuntimeState {
  viewId: string;
  memorySummary: string;
  recentTurns: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
  lastRunAt?: string | null;
}

export interface AuthoringApprovalState {
  pending: boolean;
  lastSuggestionId?: string | null;
}

export interface AuthoringSessionPayload {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
  focusViewId: string | null;
  baseVersion: number;
  dirty: boolean;
  stale: boolean;
  canonicalDraft: DashboardDocument;
  authoringState: AuthoringRuntimeState;
  viewStatesByViewId: Record<string, FocusedViewRuntimeState>;
  approvalState: AuthoringApprovalState;
  updatedAt: string;
}

export interface OpenSessionRequest {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  sessionId: string;
}

export interface SaveSessionRequest {
  payload: AuthoringSessionPayload;
}

export interface OpenSessionResponse {
  headVersion: number;
  restoredFromSession: boolean;
  stale: boolean;
  presence: EditingPresenceEntry[];
  sessionPayload: AuthoringSessionPayload;
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
