import type { DashboardDocument } from "@/contracts";
import { isDraftReadyForCompose } from "@/ai/authoring/compose-readiness";
import type { AuthoringConversationSignals } from "@/ai/authoring/messages/conversation-signals";
import type { AuthoringWorkingDraftSnapshot } from "@/ai/authoring/contracts/session-state";
import type { AuthoringToolName } from "@/ai/authoring/types";

const STAGING_REPAIR_TOOLS = new Set<AuthoringToolName>([
  "upsertQuery",
  "upsertView",
  "upsertBinding",
  "deleteQuery",
  "deleteView",
  "deleteBinding",
]);

const COMPOSE_BLOCKING_FAILURE_TOOLS = new Set<string>([
  "upsertQuery",
  "upsertView",
  "upsertBinding",
  "runCheck",
  "composePatch",
]);

type StepHistoryEntry = {
  toolName: string;
  outcome: "ok" | "error";
};

function hasPendingLocalDraftOutput(
  conversation: Pick<
    AuthoringConversationSignals,
    "approvalState" | "latestDraftOutput"
  >,
): boolean {
  return Boolean(conversation.latestDraftOutput?.suggestion.dashboard);
}

function stagingSuccessResolvesFailure(input: {
  failedToolName: string;
  repairedToolName: string;
}): boolean {
  if (
    input.failedToolName === "runCheck" ||
    input.failedToolName === "composePatch"
  ) {
    return STAGING_REPAIR_TOOLS.has(input.repairedToolName as AuthoringToolName);
  }
  return input.failedToolName === input.repairedToolName;
}

function unresolvedBlockingFailureBlocksCompose(input: {
  stepHistory: StepHistoryEntry[];
  lastFailedToolName?: string | null;
}): boolean {
  let unresolvedFailure = input.lastFailedToolName ?? null;
  if (
    unresolvedFailure &&
    !COMPOSE_BLOCKING_FAILURE_TOOLS.has(unresolvedFailure)
  ) {
    unresolvedFailure = null;
  }

  for (const entry of input.stepHistory) {
    if (COMPOSE_BLOCKING_FAILURE_TOOLS.has(entry.toolName)) {
      unresolvedFailure = entry.outcome === "error" ? entry.toolName : null;
      continue;
    }
    if (
      unresolvedFailure &&
      entry.outcome === "ok" &&
      stagingSuccessResolvesFailure({
        failedToolName: unresolvedFailure,
        repairedToolName: entry.toolName,
      })
    ) {
      unresolvedFailure = null;
    }
  }

  return Boolean(unresolvedFailure);
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
  stepHistoryInTurn?: StepHistoryEntry[];
  lastFailedToolName?: string | null;
}): AuthoringToolName[] {
  if (
    input.conversation.approvalState === "approved" ||
    input.conversation.approvalState === "requested"
  ) {
    return input.tools.filter(
      (toolName) => toolName !== "composePatch" && toolName !== "applyPatch",
    );
  }

  if (hasPendingLocalDraftOutput(input.conversation)) {
    return input.tools.filter(
      (toolName) => toolName !== "composePatch" && toolName !== "applyPatch",
    );
  }

  const authoringTools = input.tools.filter(
    (toolName) => toolName !== "composePatch" && toolName !== "applyPatch",
  );
  const canCompose = isDraftComposable({
    dashboard: input.dashboard,
    draft: input.draft,
  }) && !unresolvedBlockingFailureBlocksCompose({
    stepHistory: input.stepHistoryInTurn ?? [],
    lastFailedToolName: input.lastFailedToolName,
  });

  return canCompose ? [...authoringTools, "composePatch"] : authoringTools;
}

export function deriveDraftLifecyclePhase(input: {
  dashboard: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null | undefined;
  conversation: Pick<
    AuthoringConversationSignals,
    "approvalState" | "latestDraftOutput"
  >;
  stepHistoryInTurn?: StepHistoryEntry[];
  lastFailedToolName?: string | null;
}): "drafting" | "recovering_tool_error" | "ready_to_compose" | "awaiting_approval" {
  if (
    input.conversation.approvalState !== "none" ||
    hasPendingLocalDraftOutput(input.conversation)
  ) {
    return "awaiting_approval";
  }
  if (
    unresolvedBlockingFailureBlocksCompose({
      stepHistory: input.stepHistoryInTurn ?? [],
      lastFailedToolName: input.lastFailedToolName,
    })
  ) {
    return "recovering_tool_error";
  }
  return isDraftComposable({ dashboard: input.dashboard, draft: input.draft })
    ? "ready_to_compose"
    : "drafting";
}

export function hasUnresolvedDraftFailure(input: {
  stepHistoryInTurn?: StepHistoryEntry[];
  lastFailedToolName?: string | null;
}): boolean {
  return unresolvedBlockingFailureBlocksCompose({
    stepHistory: input.stepHistoryInTurn ?? [],
    lastFailedToolName: input.lastFailedToolName,
  });
}
