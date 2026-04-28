import type { DashboardDocument } from "@/contracts";
import { isDraftReadyForCompose } from "@/ai/authoring/compose-readiness";
import type { DraftStatusToolOutput } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringConversationSignals } from "@/ai/authoring/messages/conversation-signals";
import type { AuthoringWorkingDraftSnapshot } from "@/ai/authoring/contracts/session-state";
import type {
  AuthoringLifecycleDecision,
  AuthoringToolChoice,
  AuthoringToolName,
} from "@/ai/authoring/types";

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

const DRAFTING_BLOCKED_TOOLS = new Set<AuthoringToolName>([
  "runCheck",
  "composePatch",
  "applyPatch",
]);

const REPAIR_TOOLS = new Set<AuthoringToolName>([
  "getViews",
  "getView",
  "getQuery",
  "getBinding",
  "getDraftStatus",
  "getDatasources",
  "getSchemaByDatasource",
  "loadSkill",
  "loadSkillReference",
  "runCheck",
  "upsertQuery",
  "upsertView",
  "upsertBinding",
  "deleteQuery",
  "deleteView",
  "deleteBinding",
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
  if (
    input.repairedToolName === "upsertBinding" &&
    (input.failedToolName === "upsertQuery" ||
      input.failedToolName === "upsertView")
  ) {
    return true;
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
  void input.dashboard;
  void input.draft;
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
  if (unresolvedBlockingFailureBlocksCompose({
    stepHistory: input.stepHistoryInTurn ?? [],
    lastFailedToolName: input.lastFailedToolName,
  })) {
    return authoringTools;
  }

  return authoringTools;
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
}): "drafting" | "recovering_tool_error" | "awaiting_approval" {
  void input.dashboard;
  void input.draft;
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
  return "drafting";
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

function forcedToolChoice(toolName: AuthoringToolName): AuthoringToolChoice {
  return {
    type: "tool",
    toolName,
  };
}

function forceOnlyTool(toolName: AuthoringToolName): {
  activeTools: AuthoringToolName[];
  toolChoice: AuthoringToolChoice;
} {
  return {
    activeTools: [toolName],
    toolChoice: forcedToolChoice(toolName),
  };
}

function draftingTools(tools: AuthoringToolName[]): AuthoringToolName[] {
  return tools.filter((toolName) => !DRAFTING_BLOCKED_TOOLS.has(toolName));
}

function repairTools(tools: AuthoringToolName[]): AuthoringToolName[] {
  return tools.filter((toolName) => REPAIR_TOOLS.has(toolName));
}

export function deriveAuthoringLifecycleDecision(input: {
  tools: AuthoringToolName[];
  conversation: Pick<
    AuthoringConversationSignals,
    "approvalState" | "latestDraftOutput"
  >;
  draftStatus: DraftStatusToolOutput;
  stepHistoryInTurn?: StepHistoryEntry[];
  lastFailedToolName?: string | null;
}): AuthoringLifecycleDecision {
  if (input.conversation.approvalState === "approved") {
    return {
      phase: "completed",
      nextAction: "none",
      activeTools: [],
      toolChoice: "none",
      reason: "The current proposal has already been approved and applied locally.",
    };
  }

  if (
    input.conversation.approvalState === "requested" ||
    hasPendingLocalDraftOutput(input.conversation)
  ) {
    return {
      phase: "awaiting_approval",
      nextAction: "await_approval",
      activeTools: [],
      toolChoice: "none",
      reason: "A local approval proposal is already staged for the user.",
    };
  }

  const unresolvedFailure =
    input.draftStatus.blockers.includes("unresolved_tool_failure") ||
    unresolvedBlockingFailureBlocksCompose({
      stepHistory: input.stepHistoryInTurn ?? [],
      lastFailedToolName: input.lastFailedToolName,
    });
  if (unresolvedFailure) {
    const activeTools = repairTools(input.tools);
    return {
      phase: "recovering_tool_error",
      nextAction: "fix_failure",
      activeTools,
      toolChoice: activeTools.length > 0 ? "auto" : "none",
      reason: "A blocking authoring tool failure must be repaired before checks or composition.",
    };
  }

  if (input.draftStatus.next_required_action === "decide_data_mode") {
    return {
      phase: "drafting",
      nextAction: "decide_data_mode",
      activeTools: [],
      toolChoice: "none",
      reason: "A staged view needs a data-mode decision before bindings can be created.",
    };
  }

  if (input.draftStatus.next_required_action === "stage_binding") {
    const forced = forceOnlyTool("upsertBinding");
    return {
      phase: "drafting",
      nextAction: "stage_binding",
      ...forced,
      reason: "The staged view is missing required bindings for the selected data mode.",
    };
  }

  if (input.draftStatus.next_required_action === "run_check") {
    const forced = forceOnlyTool("runCheck");
    return {
      phase: "ready_to_check",
      nextAction: "run_check",
      ...forced,
      reason: "The staged query/view/binding/layout contract is complete and needs a fresh runCheck.",
    };
  }

  if (
    input.draftStatus.next_required_action === "compose_patch" ||
    input.draftStatus.can_compose
  ) {
    const forced = forceOnlyTool("composePatch");
    return {
      phase: "ready_to_compose",
      nextAction: "compose_patch",
      ...forced,
      reason: "The current document hash has a fresh successful runCheck and is ready for local approval composition.",
    };
  }

  const activeTools = draftingTools(input.tools);
  if (input.draftStatus.next_required_action === "none") {
    return {
      phase: input.draftStatus.has_draft ? "drafting" : "idle",
      nextAction: "none",
      activeTools,
      toolChoice: activeTools.length > 0 ? "auto" : "none",
      reason: input.draftStatus.has_draft
        ? "The staged draft has no forced lifecycle action at the moment."
        : "No staged draft lifecycle action is currently forced.",
    };
  }

  return {
    phase: input.draftStatus.has_draft ? "drafting" : "idle",
    nextAction: input.draftStatus.next_required_action,
    activeTools,
    toolChoice: activeTools.length > 0 ? "auto" : "none",
    reason: `Draft lifecycle is waiting for ${input.draftStatus.next_required_action}.`,
  };
}
