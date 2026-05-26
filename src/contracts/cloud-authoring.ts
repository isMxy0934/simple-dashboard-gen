import type { DashboardDocument } from "./dashboard";

export type WorkspaceRoleId = "viewer" | "editor" | "admin";

export interface WorkspaceRole {
  role_id: WorkspaceRoleId;
  name: string;
  permissions: string[];
}

export interface WorkspaceMember {
  user_id: string;
  workspace_id: string;
  name: string;
  email?: string;
  role_id: WorkspaceRoleId;
  role_name: string;
}

export type WorkspaceUserLocale = "zh" | "en";

export interface WorkspaceUserSettings {
  workspace_id: string;
  user_id: string;
  verbose: boolean;
  locale: WorkspaceUserLocale;
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

export type AuthoringMobileLayoutMode = "auto" | "custom";

export interface AuthoringSessionPayload {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  editingSessionId: string;
  focusViewId: string | null;
  baseVersion: number;
  dirty: boolean;
  stale: boolean;
  mobileLayoutMode: AuthoringMobileLayoutMode;
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
  editingSessionId: string;
}

export interface SaveSessionRequest {
  payload: AuthoringSessionPayload;
  expectedSessionRevision: number;
  expectedDocumentHash: string;
}

export interface OpenSessionResponse {
  headVersion: number;
  draftVersion: number;
  documentHash: string;
  sessionRevision: number;
  dirty: boolean;
  restoredFromSession: boolean;
  stale: boolean;
  presence: EditingPresenceEntry[];
  sessionPayload: AuthoringSessionPayload;
}

export interface CloudSaveDraftRequest {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  editingSessionId: string;
  expectedDraftVersion: number;
  expectedDocumentHash: string;
  baseVersion?: number;
  force?: boolean;
  draft: DashboardDocument;
}

export interface CloudPublishRequest {
  workspaceId: string;
  userId: string;
  dashboardId: string;
  editingSessionId: string;
  draftVersion: number;
  documentHash: string;
}

export interface WorkspaceContextPayload {
  workspace_id: string;
  workspace_name: string;
  current_user_id: string;
  current_user_permissions: string[];
  roles: WorkspaceRole[];
  users: WorkspaceMember[];
}

export interface WorkspaceUserRoleUpdateResponse {
  user: WorkspaceMember;
  requires_relogin: boolean;
}
