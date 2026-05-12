import { buildAuthoringToolRegistry } from "@/ai/authoring/tools/registry-builder";
import {
  createAuthoringToolRuntimeContext,
  type AuthoringToolRuntimeUpdate,
  type BuildAuthoringToolsInput,
} from "@/ai/authoring/tools/runtime-context";

export function buildAuthoringTools(input: BuildAuthoringToolsInput) {
  const runtime = createAuthoringToolRuntimeContext(input);

  const buildCurrentTools = () =>
    buildAuthoringToolRegistry({
      runtime,
      dashboardId: input.dashboardId,
      dependencies: input.dependencies,
      findLatestDraftOutput: input.findLatestDraftOutput,
      findDraftOutputBySuggestionId: input.findDraftOutputBySuggestionId,
      getActiveGoalId: input.getActiveGoalId,
      getActiveGoal: input.getActiveGoal,
      getRuntimeApprovalContext: input.getRuntimeApprovalContext,
      getBaseVersion: input.getBaseVersion,
      onDeclareAuthoringGoal: input.onDeclareAuthoringGoal,
    });

  let currentTools = buildCurrentTools();

  return {
    getTools: () => currentTools,
    updateRuntimeContext(ctx: AuthoringToolRuntimeUpdate): void {
      runtime.updateRuntimeContext(ctx);
      currentTools = buildCurrentTools();
    },
    getCandidateDocumentSnapshot: runtime.getCandidateDocumentSnapshot,
    getCandidateDocumentFingerprintSnapshot:
      runtime.getCandidateDocumentFingerprintSnapshot,
    getContextStatusSnapshot: runtime.getContextStatusSnapshot,
    getDraftSnapshot: runtime.getDraftSnapshot,
    getDraftStatusSnapshot: () =>
      runtime.getDraftStatusSnapshot(input.getActiveGoal?.() ?? null),
    getLastRunCheckStateSnapshot: runtime.getLastRunCheckStateSnapshot,
    discardWorkingDraft(): void {
      runtime.resetWorkingDraft();
    },
  };
}
