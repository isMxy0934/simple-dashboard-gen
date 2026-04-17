import type { DashboardDocument } from "@/contracts";
import { reconcileDashboardDocumentContract } from "@/domain/dashboard/document";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneQuery,
} from "@/ai/authoring/tools/draft-state";

export function buildCandidateDocument(
  dashboard: DashboardDocument,
  workingDraft: WorkingDraftState,
): DashboardDocument {
  const nextDocument = JSON.parse(JSON.stringify(dashboard)) as DashboardDocument;
  const pruneUnusedQueries =
    Boolean(workingDraft.dashboardSpec) && !workingDraft.queryDefs;

  if (workingDraft.dashboardSpec) {
    nextDocument.dashboard_spec = cloneDashboardSpec(workingDraft.dashboardSpec);
  }

  if (workingDraft.queryDefs) {
    nextDocument.query_defs = workingDraft.queryDefs.map(cloneQuery);
  }

  if (workingDraft.bindings) {
    nextDocument.bindings = workingDraft.bindings.map(cloneBinding);
  }

  return reconcileDashboardDocumentContract(nextDocument, {
    pruneUnusedQueries,
  });
}

export function buildDocumentFingerprint(document: DashboardDocument) {
  return dashboardDocumentPersistenceFingerprint(document);
}
