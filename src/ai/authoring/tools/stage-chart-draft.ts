import type {
  Binding,
  DashboardDocument,
  QueryDef,
} from "@/contracts";
import type { DraftStatusToolOutput } from "@/ai/authoring/contracts/tool-io";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneQuery,
  markWorkingDraftArtifactOwner,
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";

export function applyStagedChartToDraft(input: {
  nextDocument: DashboardDocument;
  viewId: string;
  query: QueryDef | null;
  bindings: Binding[];
  dataMode: "live" | "mock" | undefined;
  ownerGoalId: string | null | undefined;
  workingDraft: WorkingDraftState;
  markWorkingDraftUpdated: () => void;
}) {
  input.workingDraft.dashboardSpec = cloneDashboardSpec(input.nextDocument.dashboard_spec);
  input.workingDraft.queryDefs = input.nextDocument.query_defs.map(cloneQuery);
  input.workingDraft.bindings = input.nextDocument.bindings.map(cloneBinding);
  input.workingDraft.bindingMode = input.dataMode ?? (input.query ? "live" : "mock");
  input.workingDraft.dirtyViewIds.add(input.viewId);
  input.workingDraft.layoutTouched = true;
  if (input.query) {
    input.workingDraft.dirtyQueryIds.add(input.query.id);
  }
  for (const binding of input.bindings) {
    input.workingDraft.dirtyBindingIds.add(binding.id);
  }
  markWorkingDraftArtifactOwner({
    workingDraft: input.workingDraft,
    goalId: input.ownerGoalId,
    artifactKind: "view",
    artifactId: input.viewId,
  });
  markWorkingDraftArtifactOwner({
    workingDraft: input.workingDraft,
    goalId: input.ownerGoalId,
    artifactKind: "layout",
    artifactId: input.viewId,
  });
  if (input.query) {
    markWorkingDraftArtifactOwner({
      workingDraft: input.workingDraft,
      goalId: input.ownerGoalId,
      artifactKind: "query",
      artifactId: input.query.id,
    });
  }
  for (const binding of input.bindings) {
    markWorkingDraftArtifactOwner({
      workingDraft: input.workingDraft,
      goalId: input.ownerGoalId,
      artifactKind: "binding",
      artifactId: binding.id,
    });
  }
  input.markWorkingDraftUpdated();
}
