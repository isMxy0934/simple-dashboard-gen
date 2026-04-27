import type { DashboardDocument } from "@/contracts";
import { isDraftReadyForCompose } from "@/ai/authoring/compose-readiness";
import type { AuthoringConversationSignals } from "@/ai/authoring/messages/conversation-signals";
import type { AuthoringWorkingDraftSnapshot } from "@/ai/authoring/contracts/session-state";
import type { AuthoringToolName } from "@/ai/authoring/types";

const USER_VISIBLE_STAGING_TOOLS = new Set<AuthoringToolName>([
  "upsertView",
  "upsertBinding",
  "deleteView",
  "deleteBinding",
]);

type StepHistoryEntry = {
  toolName: string;
  outcome: "ok" | "error";
};

function hasSuccessfulUserVisibleStagingWrite(
  stepHistory: StepHistoryEntry[],
): boolean {
  return stepHistory.some(
    (entry) =>
      entry.outcome === "ok" &&
      USER_VISIBLE_STAGING_TOOLS.has(entry.toolName as AuthoringToolName),
  );
}

export function resolveMechanicalDraftCompletionTool(input: {
  dashboard: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null | undefined;
  conversation: Pick<
    AuthoringConversationSignals,
    "approvalState" | "latestDraftOutput"
  >;
  stepHistoryInTurn: StepHistoryEntry[];
}): AuthoringToolName | null {
  if (input.conversation.approvalState !== "none") {
    return null;
  }

  if (input.conversation.latestDraftOutput) {
    return input.stepHistoryInTurn.some((entry) => entry.toolName === "applyPatch")
      ? null
      : "applyPatch";
  }

  if (
    !hasSuccessfulUserVisibleStagingWrite(input.stepHistoryInTurn) ||
    input.stepHistoryInTurn.some((entry) => entry.toolName === "composePatch")
  ) {
    return null;
  }

  return isDraftReadyForCompose({
    dashboard: input.dashboard,
    draft: input.draft,
  })
    ? "composePatch"
    : null;
}
