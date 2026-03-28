import type { DashboardDocument } from "../../../contracts";

export type AuthoringBreakpoint = "desktop" | "mobile";
export type MobileLayoutMode = "auto" | "custom";

export const AUTHORING_DRAFT_STORAGE_KEY = "ai-dashboard-studio.authoring-draft.v2";

export interface PersistedAuthoringState {
  dashboard: DashboardDocument;
  selectedViewId: string | null;
  mobileLayoutMode: MobileLayoutMode;
  localSessionId?: string;
  updatedAt: string;
}
