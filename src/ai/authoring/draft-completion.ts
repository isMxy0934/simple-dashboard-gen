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

function draftQueryIsVisible(input: {
  dashboard: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot;
}): boolean {
  const dirtyQueryIds = new Set(input.draft.dirtyQueryIds);
  if (dirtyQueryIds.size === 0) {
    return false;
  }

  const bindings = input.draft.bindings ?? input.dashboard.bindings;
  return bindings.some(
    (binding) => binding.query_id && dirtyQueryIds.has(binding.query_id),
  );
}

export function isDraftComposable(input: {
  dashboard: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null | undefined;
}): boolean {
  const draft = input.draft;
  if (!draft) {
    return false;
  }

  const hasVisibleChange =
    draft.dirtyViewIds.length > 0 ||
    draft.dirtyBindingIds.length > 0 ||
    draft.layoutTouched ||
    draftQueryIsVisible({ dashboard: input.dashboard, draft });

  return (
    hasVisibleChange &&
    isDraftReadyForCompose({
      dashboard: input.dashboard,
      draft,
    })
  );
}

export function filterDraftLifecycleTools(input: {
  tools: AuthoringToolName[];
  dashboard: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null | undefined;
  conversation: Pick<
    AuthoringConversationSignals,
    "approvalState" | "latestDraftOutput"
  >;
}): AuthoringToolName[] {
  if (
    input.conversation.approvalState !== "none" ||
    input.conversation.latestDraftOutput
  ) {
    return input.tools;
  }

  const canCompose = isDraftComposable({
    dashboard: input.dashboard,
    draft: input.draft,
  });

  return input.tools.filter((toolName) => {
    if (toolName === "composePatch") {
      return canCompose;
    }
    if (toolName === "applyPatch") {
      return false;
    }
    return true;
  });
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

  return isDraftComposable({
    dashboard: input.dashboard,
    draft: input.draft,
  })
    ? "composePatch"
    : null;
}
