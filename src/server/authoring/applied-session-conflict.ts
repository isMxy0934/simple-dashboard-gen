import type { AuthoringSessionPayload, DashboardDocument } from "@/contracts";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";

export type AppliedEditingSessionConflictResolution =
  | "already_applied"
  | "same_dashboard"
  | "conflict";

export function resolveAppliedEditingSessionConflict(input: {
  latestPayload: AuthoringSessionPayload;
  suggestionId: string;
  appliedDashboard: DashboardDocument;
}): AppliedEditingSessionConflictResolution {
  if (input.latestPayload.approvalState.lastSuggestionId === input.suggestionId) {
    return "already_applied";
  }
  if (
    dashboardDocumentPersistenceFingerprint(input.latestPayload.canonicalDraft) ===
    dashboardDocumentPersistenceFingerprint(input.appliedDashboard)
  ) {
    return "same_dashboard";
  }
  return "conflict";
}
