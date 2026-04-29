import {
  createAgentUIStream,
  createUIMessageStream,
  generateText,
  Output,
  safeValidateUIMessages,
  stepCountIs,
  ToolLoopAgent,
  type UIMessageStreamOnFinishCallback,
  type UIMessageStreamOnStepFinishCallback,
} from "ai";
import type { DashboardDocument } from "@/contracts";
import { resolveProviderModelConfig } from "@/ai/providers/index";
import type {
  AuthoringIntent,
  AuthoringMessage,
  AuthoringApprovalEvent,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  DraftStatusToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringCapabilityProfile,
  AuthoringScope,
  AuthoringToolChoice,
  AuthoringToolName,
} from "@/ai/authoring/contracts/runtime";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringTaskStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import { buildAuthoringTools } from "@/ai/authoring/tools/factory";
import { buildAuthoringSystemPrompt } from "@/ai/authoring/messages/system-prompt";
import { computeAuthoringScope } from "@/ai/authoring/runtime/capability-scope";
import { buildViewListSummary } from "@/ai/authoring/messages/context-summary";
import { buildAuthoringContextBlock } from "@/ai/authoring/messages/context-block";
import { injectAuthoringContext } from "@/ai/authoring/messages/context-inject";
import { redactSupersededToolOutputs } from "@/ai/authoring/messages/redact";
import { prepareDeepSeekThinkingUiMessages } from "@/ai/authoring/messages/deepseek-thinking";
import {
  upsertBindingInputSchema,
  upsertLayoutInputSchema,
  upsertQueryInputSchema,
  upsertViewInputSchema,
} from "@/ai/authoring/tools/schemas";
import type { MutationDescriptor } from "@/ai/authoring/messages/invalidate-on-mutation";
import {
  createValidationOnlyAuthoringDependencies,
  writeAuthoringTrace,
} from "@/ai/authoring/runtime/dependencies";
import {
  deriveConversationSignalsFromModelMessages,
  deriveConversationSignalsFromUiMessages,
} from "@/ai/authoring/messages/conversation-signals";
import { invalidateMutatedModelMessages } from "@/ai/authoring/messages/model-message-mutation";
import { findLatestDraftOutput } from "@/ai/authoring/messages/inspection";
import { sanitizeAuthoringMessages } from "@/ai/authoring/messages/ui-message-sanitize";
import { buildRepairToolPrompt } from "@/ai/authoring/messages/repair-prompt";
import {
  updateTaskStateFromUserTurn,
  updateTaskStateFromToolStep,
} from "@/ai/authoring/runtime/runtime-facts";
import { extractTurnIntentV2 } from "@/ai/authoring/runtime/intent-extraction";
import {
  applyWorkflowTransitionV2,
  decideNextActionV2,
  getActiveGoalV2,
  inspectArtifactsV2,
  isWorkflowToolAllowedV2,
  normalizeWorkflowStateV2,
  prepareForcedToolStepV2,
  reduceIntentToWorkflowStateV2,
} from "@/ai/authoring/v2";
import type {
  ApprovalStateV2,
  ArtifactStatusV2,
  TurnIntentV2,
  WorkflowActionV2,
  WorkflowStateV2,
  WorkflowToolExecutionV2,
} from "@/ai/authoring/v2/types";

const DEFAULT_WALL_CLOCK_MS = 60_000;
const DEFAULT_REASONING_WALL_CLOCK_MS = 180_000;
const DEFAULT_TURN_TOKEN_BUDGET = 32_000;
function usesDeepSeekThinking(runtime: {
  providerKind: string;
  providerOptions: unknown;
}): boolean {
  const providerOptions = runtime.providerOptions as {
    deepseek?: { thinking?: { type?: string } };
  };

  return (
    runtime.providerKind === "deepseek" &&
    providerOptions.deepseek?.thinking?.type === "enabled"
  );
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveWallClockMs(
  runtime: { providerKind: string; providerOptions: unknown },
  overrideMs: number | undefined,
): number {
  if (typeof overrideMs === "number" && overrideMs > 0) {
    return overrideMs;
  }

  const envMs = parsePositiveInteger(process.env.AUTHORING_AGENT_WALL_CLOCK_MS);
  if (envMs) {
    return envMs;
  }

  return usesDeepSeekThinking(runtime)
    ? DEFAULT_REASONING_WALL_CLOCK_MS
    : DEFAULT_WALL_CLOCK_MS;
}

function isSemanticToolResultError(input: {
  toolName: string;
  result: unknown;
}): boolean {
  if (
    typeof input.result === "object" &&
    input.result !== null &&
    "error" in input.result &&
    (input.result as { error?: unknown }).error !== undefined
  ) {
    return true;
  }

  if (
    input.toolName === "runCheck" &&
    typeof input.result === "object" &&
    input.result !== null &&
    "output" in input.result
  ) {
    const output = (input.result as { output?: unknown }).output;
    return (
      typeof output === "object" &&
      output !== null &&
      "status" in output &&
      (output as { status?: unknown }).status === "error"
    );
  }

  return false;
}

function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s != null);
  if (present.length === 0) {
    return undefined;
  }
  if (present.length === 1) {
    return present[0];
  }
  const controller = new AbortController();
  const forward = () => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  };
  for (const signal of present) {
    if (signal.aborted) {
      forward();
      break;
    }
    signal.addEventListener("abort", forward, { once: true });
  }
  return controller.signal;
}

function hasWorkingDraftSnapshot(
  snapshot: AuthoringWorkingDraftSnapshot | null | undefined,
): boolean {
  if (!snapshot) {
    return false;
  }
  return (
    Boolean(snapshot.dashboardSpec) ||
    Boolean(snapshot.queryDefs?.length) ||
    Boolean(snapshot.bindings?.length) ||
    Boolean(snapshot.bindingMode) ||
    snapshot.dirtyViewIds.length > 0 ||
    snapshot.dirtyQueryIds.length > 0 ||
    snapshot.dirtyBindingIds.length > 0 ||
    snapshot.layoutTouched
  );
}

function buildRuntimeCheckStatusV2(input: {
  draftStatus: DraftStatusToolOutput;
  taskState: AuthoringTaskStateSnapshot;
}): ArtifactStatusV2["runtimeCheck"] | undefined {
  const failedTool = input.taskState.lastFailedTool;
  if (failedTool?.toolName === "runCheck") {
    return {
      required: true,
      status: "failed",
      errors: [
        {
          code: failedTool.code ?? "run_check_failed",
          message: failedTool.userSafeSummary ?? failedTool.errorSummary,
        },
      ],
    };
  }
  if (input.draftStatus.check_fresh) {
    return { required: true, status: "passed", errors: [] };
  }
  if (input.draftStatus.blockers.includes("stale_check")) {
    return {
      required: true,
      status: input.draftStatus.last_check_hash ? "stale" : "not_run",
      errors: [],
    };
  }
  return undefined;
}

function buildApprovalStateV2(
  workflowState: WorkflowStateV2,
  approvalEvent?: AuthoringApprovalEvent | null,
): ApprovalStateV2 {
  return {
    ...(workflowState.pendingProposalId
      ? { pendingProposalId: workflowState.pendingProposalId }
      : {}),
    ...(typeof workflowState.pendingProposalBaseVersion === "number"
      ? { pendingProposalBaseVersion: workflowState.pendingProposalBaseVersion }
      : {}),
    userApproved: approvalEvent?.decision === "approve",
    source: approvalEvent ? "ui_event" : "none",
  };
}

function getWorkflowToolExecutionV2(input: {
  action: WorkflowActionV2;
  toolResults?: Array<{ toolName?: string; output?: unknown; error?: unknown }>;
}): WorkflowToolExecutionV2 {
  const toolName = "tool" in input.action ? input.action.tool : null;
  if (!toolName) {
    return {
      status: "failed",
      reason: "missing_result",
      message: "Workflow action does not have an associated tool.",
    };
  }
  const result = input.toolResults?.find(
    (candidate) => candidate.toolName === toolName,
  );
  if (!result) {
    return {
      status: "failed",
      reason: "missing_result",
      message: `${toolName} did not return a tool result.`,
    };
  }
  if (result.error !== undefined) {
    return {
      status: "failed",
      reason: "tool_error",
      message: `${toolName} returned a tool execution error.`,
      output: result.output,
      error: result.error,
    };
  }
  if (isSemanticToolResultError({ toolName, result })) {
    return {
      status: "failed",
      reason: "semantic_error",
      message: `${toolName} returned a semantic failure result.`,
      output: result.output,
    };
  }
  return { status: "succeeded", output: result.output };
}

function enforceWorkflowToolCapability(input: {
  action: WorkflowActionV2;
  scopedTools: AuthoringToolName[];
  scope: AuthoringScope;
  intent: TurnIntentV2 | null;
}): WorkflowActionV2 {
  if (!("tool" in input.action)) {
    return input.action;
  }
  if (
    isWorkflowToolAllowedV2({
      action: input.action,
      scopedTools: input.scopedTools,
      scope: input.scope,
      intent: input.intent,
    })
  ) {
    return input.action;
  }
  return {
    kind: "block_goal",
    blocker: "tool_not_allowed",
    reason: `The workflow selected ${input.action.tool}, but the current scope does not allow that tool.`,
  };
}

function defaultPromptSectionsForCapabilityProfile(
  profile: AuthoringCapabilityProfile,
): string[] {
  switch (profile) {
    case "chat":
      return ["identity", "chat"];
    case "explore":
      return ["identity", "explore"];
    case "author-focused":
      return ["identity", "authoring", "focused"];
    case "approval":
      return ["identity", "approval"];
    default:
      return ["identity", "authoring", "dashboard"];
  }
}

function promptSectionsForWorkflowAction(input: {
  action: WorkflowActionV2 | null;
  intent: TurnIntentV2 | null;
  defaultSections: string[];
}): string[] {
  if (input.intent?.kind === "explore_data") {
    return ["identity", "explore"];
  }
  if (
    input.action?.kind === "await_approval" ||
    input.intent?.kind === "approve_patch_text"
  ) {
    return ["identity", "approval"];
  }
  if (
    input.action?.kind === "answer" ||
    input.action?.kind === "complete_goal" ||
    input.action?.kind === "ask_user" ||
    input.action?.kind === "block_goal" ||
    input.action?.kind === "reject_patch"
  ) {
    return ["identity", "chat"];
  }
  return input.defaultSections;
}

function buildScopeInput(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  conversation: ReturnType<typeof deriveConversationSignalsFromUiMessages>;
  focusedViewId?: string | null;
  checks?: ViewCheckSnapshot[] | null;
  skills?: AuthoringSkillSummary[] | null;
  stepHistoryInTurn?: Array<{ toolName: string; outcome: "ok" | "error" }>;
  intent?: AuthoringIntent | null;
  lockedProfile?: AuthoringCapabilityProfile | null;
}) {
  const summary = buildViewListSummary({
    document: input.dashboard,
    dashboardId: input.dashboardId,
    checks: input.checks,
  });
  const checksSummary = (input.checks ?? []).reduce(
    (acc, check) => {
      if (check.status === "error") {
        acc.error += 1;
      } else if (check.status === "ok") {
        acc.ok += 1;
      } else if (check.status === "empty") {
        acc.warning += 1;
      }
      return acc;
    },
    { ok: 0, warning: 0, error: 0 },
  );

  return {
    dashboard: {
      id: input.dashboardId ?? null,
      name: input.dashboard.dashboard_spec.dashboard.name,
      views: summary.views.map((view) => ({
        id: view.id,
        title: view.title,
        renderer_kind: view.renderer_kind,
        check_status: view.check_status,
      })),
      datasources: input.datasources ?? [],
      checksSummary,
    },
    conversation: input.conversation,
    focusedViewId: input.focusedViewId ?? null,
    stepHistoryInTurn: input.stepHistoryInTurn ?? [],
    skills: input.skills ?? [],
    intentSignal: input.intent ?? null,
    lockedProfile: input.lockedProfile ?? null,
  };
}

export async function safeValidateMessages(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: unknown;
  dependencies?: AuthoringDependencies;
}) {
  const tools = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    dependencies: input.dependencies ?? createValidationOnlyAuthoringDependencies(),
  }).tools;

  const validated = await safeValidateUIMessages<AuthoringMessage>({
    messages: input.messages,
    tools: tools as never,
  });

  if (!validated.success) {
    return validated;
  }

  return {
    success: true,
    data: sanitizeAuthoringMessages(validated.data),
  } as typeof validated;
}

export async function createAuthoringAgentStream(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  messages: AuthoringMessage[];
  initialWorkingDraft?: AuthoringWorkingDraftSnapshot | null;
  initialLastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  initialTaskState?: AuthoringTaskStateSnapshot | null;
  initialWorkflowStateV2?: WorkflowStateV2 | null;
  sessionId?: string;
  abortSignal?: AbortSignal;
  dependencies?: AuthoringDependencies;
  /** Optional UI-declared intent forwarded to the scope layer. */
  intent?: AuthoringIntent | null;
  /** Draft base version used to bind approval events to a proposal. */
  baseVersion?: number;
  /** Explicit UI approval event. Ordinary chat text must not set this. */
  approvalEvent?: AuthoringApprovalEvent | null;
  /** Max wall-clock time for this turn (ms). Default 60_000, or 180_000 for thinking models. */
  wallClockTimeoutMs?: number;
  /** Max total tokens per turn (sum of per-step usage). Default 32_000. */
  turnTokenBudget?: number;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<AuthoringMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<AuthoringMessage>;
}) {
  const runtime = resolveProviderModelConfig();
  if (!input.dependencies) {
    throw new Error("Authoring dependencies are required to create the agent stream.");
  }
  const initialConversation = deriveConversationSignalsFromUiMessages(input.messages);
  const initialLatestDraft = findLatestDraftOutput(input.messages);
  const hasInitialWorkingDraft = hasWorkingDraftSnapshot(input.initialWorkingDraft);
  let currentTaskState = updateTaskStateFromUserTurn({
    previous: input.initialTaskState ?? null,
    latestUserText: initialConversation.latestUserText ?? "",
    hasWorkingDraft: hasInitialWorkingDraft,
    hasPendingApproval: Boolean(initialLatestDraft),
  });
  if (hasInitialWorkingDraft) {
    delete currentTaskState.lastBlockerQuestion;
  }
  const initialDecision = computeAuthoringScope(
    buildScopeInput({
      dashboard: input.dashboard,
      dashboardId: input.dashboardId,
      datasources: input.datasources,
      conversation: initialConversation,
      focusedViewId: input.focusedViewId,
      checks: input.checks,
      skills: input.skills,
      intent: input.intent,
      lockedProfile: null,
    }),
  );
  const turnLockedProfile = initialDecision.profile;
  let currentTurnIntentV2 = await extractTurnIntentV2({
    explicitIntent: input.intent,
    latestUserText: initialConversation.latestUserText,
    approvalEvent: input.approvalEvent,
    hasPendingProposal: Boolean(initialLatestDraft),
    model: runtime.model,
    providerOptions: runtime.providerOptions,
    supportsTemperature: runtime.supportsTemperature,
    abortSignal: input.abortSignal,
  });
  let currentWorkflowStateV2 = normalizeWorkflowStateV2(reduceIntentToWorkflowStateV2({
    state: input.initialWorkflowStateV2,
    intent: currentTurnIntentV2,
    turnId: input.sessionId ?? "turn",
    selectedDatasourceId: currentTaskState.selectedDataContext?.datasourceId,
    selectedTable: currentTaskState.selectedDataContext?.tableName,
    pendingProposalId: initialLatestDraft?.suggestion.id,
    pendingProposalBaseVersion: initialLatestDraft?.base_version ?? input.baseVersion,
  }));
  let lastPreparedWorkflowActionV2: WorkflowActionV2 | null = null;
  let runtimeApprovedProposalId: string | null = null;
  let rejectedProposalIdV2: string | null = null;

  const wallMs = resolveWallClockMs(runtime, input.wallClockTimeoutMs);
  const tokenBudget = input.turnTokenBudget ?? DEFAULT_TURN_TOKEN_BUDGET;
  const budgetController = new AbortController();
  const wallTimer = setTimeout(() => {
    budgetController.abort(new Error("authoring-wall-clock-exceeded"));
  }, wallMs);
  let cumulativeTokens = 0;

  const combinedAbortSignal = combineAbortSignals(
    input.abortSignal,
    budgetController.signal,
  );
  const toolRuntime = buildAuthoringTools({
    scope: initialDecision.scope,
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    skills: input.skills,
    messages: input.messages,
    checks: input.checks,
    initialWorkingDraft: input.initialWorkingDraft,
    dependencies: input.dependencies,
    initialLastRunCheckState: input.initialLastRunCheckState,
    initialLoadedSkillReferenceChecks: currentTaskState.loadedSkillReferenceChecks,
    getTaskState: () => currentTaskState,
    getActiveGoalId: () => getActiveGoalV2(currentWorkflowStateV2)?.id ?? null,
    getBaseVersion: () => input.baseVersion,
    hasRuntimeApproval: () =>
      Boolean(
        runtimeApprovedProposalId &&
          runtimeApprovedProposalId === currentWorkflowStateV2.pendingProposalId,
      ),
  });
  const initialDraftStatus = toolRuntime.getDraftStatusSnapshot();
  const initialDraftSnapshot = toolRuntime.getDraftSnapshot();
  const initialArtifactStatusV2 = inspectArtifactsV2({
    goal: getActiveGoalV2(currentWorkflowStateV2),
    candidate: toolRuntime.getCandidateDocumentSnapshot(),
    ownership: initialDraftSnapshot?.ownership,
    runtimeCheck: buildRuntimeCheckStatusV2({
      draftStatus: initialDraftStatus,
      taskState: currentTaskState,
    }),
    pendingProposalId: currentWorkflowStateV2.pendingProposalId,
  });
  const contextBlock = buildAuthoringContextBlock({
    variant: initialDecision.contextBlockVariant,
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    focusedViewId:
      initialDecision.scope.kind === "focused"
        ? initialDecision.scope.viewId
        : input.focusedViewId,
    datasources: input.datasources,
    checks: input.checks,
    latestUserText: initialConversation.latestUserText,
    intent: input.intent ?? null,
    draftStatus: initialDraftStatus,
    workflowStateV2: currentWorkflowStateV2,
    artifactStatusV2: initialArtifactStatusV2,
    scopeResolution: initialDecision.scopeResolution,
    taskState: currentTaskState,
    proposalSummary: initialLatestDraft
      ? {
          proposal_id: initialLatestDraft.suggestion.id,
          summary: initialLatestDraft.suggestion.summary,
          operation_count: initialLatestDraft.suggestion.patch.operations.length,
        }
      : null,
  });
  const redactedMessages = redactSupersededToolOutputs(input.messages);
  const providerCompatibleMessages = usesDeepSeekThinking(runtime)
    ? prepareDeepSeekThinkingUiMessages(redactedMessages)
    : redactedMessages;
  const modelMessages = injectAuthoringContext({
    messages: providerCompatibleMessages,
    contextBlock: contextBlock.markdown,
  });

  const allMutationsThisTurn: MutationDescriptor[] = [];

  const agent = new ToolLoopAgent({
    id: "authoring-agent",
    model: runtime.model,
    instructions: buildAuthoringSystemPrompt({
      sections: defaultPromptSectionsForCapabilityProfile(initialDecision.profile),
      scope: initialDecision.scope,
      skills: input.skills,
      relevantSkillIds: initialDecision.relevantSkillIds,
      taskState: currentTaskState,
      draftStatus: initialDraftStatus,
    }),
    tools: toolRuntime.tools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    stopWhen: stepCountIs(20),
    experimental_repairToolCall: async ({ toolCall, inputSchema, error }) => {
      if (
        toolCall.toolName !== "upsertQuery" &&
        toolCall.toolName !== "upsertView" &&
        toolCall.toolName !== "upsertBinding" &&
        toolCall.toolName !== "upsertLayout"
      ) {
        return null;
      }

      try {
        const schema = await inputSchema({ toolName: toolCall.toolName });
        const prompt = buildRepairToolPrompt({
          toolName: toolCall.toolName,
          validationError: error.message,
          jsonSchema: schema,
          invalidInput: toolCall.input,
        });
        const repairedInput =
          toolCall.toolName === "upsertQuery"
            ? (
                await generateText({
                  model: runtime.model,
                  output: Output.object({
                    schema: upsertQueryInputSchema,
                    name: "UpsertQueryInput",
                    description: "Canonical upsertQuery input.",
                  }),
                  providerOptions: runtime.providerOptions,
                  ...(runtime.supportsTemperature ? { temperature: 0 } : {}),
                  abortSignal: combinedAbortSignal,
                  prompt,
                })
              ).output
            : toolCall.toolName === "upsertView"
              ? (
                await generateText({
                  model: runtime.model,
                  output: Output.object({
                    schema: upsertViewInputSchema,
                    name: "UpsertViewInput",
                    description: "Canonical upsertView input.",
                  }),
                  providerOptions: runtime.providerOptions,
                  ...(runtime.supportsTemperature ? { temperature: 0 } : {}),
                  abortSignal: combinedAbortSignal,
                  prompt,
                })
              ).output
              : toolCall.toolName === "upsertBinding"
                ? (
                  await generateText({
                    model: runtime.model,
                    output: Output.object({
                      schema: upsertBindingInputSchema,
                      name: "UpsertBindingInput",
                      description: "Canonical upsertBinding input.",
                    }),
                    providerOptions: runtime.providerOptions,
                    ...(runtime.supportsTemperature ? { temperature: 0 } : {}),
                    abortSignal: combinedAbortSignal,
                    prompt,
                  })
                ).output
              : (
                await generateText({
                  model: runtime.model,
                  output: Output.object({
                    schema: upsertLayoutInputSchema,
                    name: "UpsertLayoutInput",
                    description: "Canonical upsertLayout input.",
                  }),
                  providerOptions: runtime.providerOptions,
                  ...(runtime.supportsTemperature ? { temperature: 0 } : {}),
                  abortSignal: combinedAbortSignal,
                  prompt,
                })
              ).output;

        return {
          ...toolCall,
          input: JSON.stringify(repairedInput),
        };
      } catch (repairError) {
        if (combinedAbortSignal?.aborted) {
          throw repairError;
        }
        return null;
      }
    },
    prepareStep: async ({ messages, steps, stepNumber }) => {
      const stepHistory = steps.flatMap((step) =>
        (step.toolCalls ?? []).map((call) => ({
          toolName: call.toolName,
          outcome: (step.toolResults ?? []).some((result) => {
            return (
              result.toolName === call.toolName &&
              !isSemanticToolResultError({
                toolName: call.toolName,
                result,
              })
            );
          })
            ? ("ok" as const)
            : ("error" as const),
        })),
      );

      const newMutations = toolRuntime.drainMutations();
      for (const mutation of newMutations) {
        allMutationsThisTurn.push(mutation);
      }
      const preparedMessages = invalidateMutatedModelMessages(
        messages,
        allMutationsThisTurn,
      );
      const conversation = deriveConversationSignalsFromModelMessages(preparedMessages);

      const decision = computeAuthoringScope(
        buildScopeInput({
          dashboard: input.dashboard,
          dashboardId: input.dashboardId,
          datasources: input.datasources,
          conversation,
          focusedViewId: input.focusedViewId,
          checks: input.checks,
          skills: input.skills,
          stepHistoryInTurn: stepHistory,
          intent: input.intent,
          lockedProfile: turnLockedProfile,
        }),
      );
      const draftStatus = toolRuntime.getDraftStatusSnapshot();
      const draftSnapshot = toolRuntime.getDraftSnapshot();
      let artifactStatusV2 = inspectArtifactsV2({
        goal: getActiveGoalV2(currentWorkflowStateV2),
        candidate: toolRuntime.getCandidateDocumentSnapshot(),
        ownership: draftSnapshot?.ownership,
        runtimeCheck: buildRuntimeCheckStatusV2({
          draftStatus,
          taskState: currentTaskState,
        }),
        pendingProposalId: currentWorkflowStateV2.pendingProposalId,
      });
      let contextStatusV2 = toolRuntime.getContextStatusSnapshot(
        getActiveGoalV2(currentWorkflowStateV2),
      );
      let scopedWorkflowActionV2: WorkflowActionV2 = { kind: "answer", reason: "missing_turn_intent" };
      for (let guard = 0; guard < 10; guard++) {
        const workflowActionV2 = currentTurnIntentV2
          ? decideNextActionV2({
              intent: currentTurnIntentV2,
              workflowState: currentWorkflowStateV2,
              contextStatus: contextStatusV2,
              artifactStatus: artifactStatusV2,
              approvalState: buildApprovalStateV2(
                currentWorkflowStateV2,
                input.approvalEvent,
              ),
            })
          : null;
        scopedWorkflowActionV2 = workflowActionV2
          ? enforceWorkflowToolCapability({
              action: workflowActionV2,
              scopedTools: decision.allowedTools,
              scope: decision.scope,
              intent: currentTurnIntentV2,
            })
          : { kind: "answer", reason: "missing_turn_intent" };
        if (scopedWorkflowActionV2.kind !== "complete_goal") {
          break;
        }
        currentWorkflowStateV2 = applyWorkflowTransitionV2({
          state: currentWorkflowStateV2,
          action: scopedWorkflowActionV2,
          baseVersion: input.baseVersion,
          contextStatus: contextStatusV2,
        });
        artifactStatusV2 = inspectArtifactsV2({
          goal: getActiveGoalV2(currentWorkflowStateV2),
          candidate: toolRuntime.getCandidateDocumentSnapshot(),
          ownership: draftSnapshot?.ownership,
          runtimeCheck: buildRuntimeCheckStatusV2({
            draftStatus,
            taskState: currentTaskState,
          }),
          pendingProposalId: currentWorkflowStateV2.pendingProposalId,
        });
        contextStatusV2 = toolRuntime.getContextStatusSnapshot(
          getActiveGoalV2(currentWorkflowStateV2),
        );
      }
      if (
        scopedWorkflowActionV2.kind === "ask_user" ||
        scopedWorkflowActionV2.kind === "block_goal" ||
        scopedWorkflowActionV2.kind === "reject_patch"
      ) {
        currentWorkflowStateV2 = applyWorkflowTransitionV2({
          state: currentWorkflowStateV2,
          action: scopedWorkflowActionV2,
          baseVersion: input.baseVersion,
          contextStatus: contextStatusV2,
        });
        if (scopedWorkflowActionV2.kind === "reject_patch") {
          rejectedProposalIdV2 = scopedWorkflowActionV2.proposalId;
        }
      }
      const forcedStepV2 = prepareForcedToolStepV2(scopedWorkflowActionV2);
      const stepTaskState = currentTaskState;
      const activeTools = forcedStepV2.activeTools;
      const toolChoice: AuthoringToolChoice = forcedStepV2.toolChoice;
      lastPreparedWorkflowActionV2 =
        "tool" in scopedWorkflowActionV2
          ? scopedWorkflowActionV2
          : null;
      runtimeApprovedProposalId =
        scopedWorkflowActionV2.kind === "apply_patch"
          ? currentWorkflowStateV2.pendingProposalId ?? null
          : runtimeApprovedProposalId;
      const systemPromptSections = promptSectionsForWorkflowAction({
        action: scopedWorkflowActionV2,
        intent: currentTurnIntentV2,
        defaultSections: defaultPromptSectionsForCapabilityProfile(decision.profile),
      });

      await writeAuthoringTrace(
        input.dependencies,
        "authoring-agent",
        "prepare-step",
        {
          sessionId: input.sessionId,
          stepNumber,
          capabilityProfile: decision.profile,
          scope: decision.scope,
          activeTools,
          toolChoice,
          workflowV2: {
            intent: currentTurnIntentV2,
            action: scopedWorkflowActionV2,
            forced: true,
            state: currentWorkflowStateV2,
            artifactStatus: artifactStatusV2,
          },
          mutationsApplied: allMutationsThisTurn.length,
          lockedProfile: turnLockedProfile,
          taskState: stepTaskState,
          draftStatus,
        },
      );

      return {
        messages: preparedMessages,
        system: buildAuthoringSystemPrompt({
          sections: systemPromptSections,
          scope: decision.scope,
          skills: input.skills,
          relevantSkillIds: decision.relevantSkillIds,
          taskState: stepTaskState,
          draftStatus,
        }),
        activeTools,
        toolChoice,
      } as never;
    },
  });

  const agentStream = await createAgentUIStream({
    agent,
    uiMessages: modelMessages,
    originalMessages: input.messages as never,
    abortSignal: combinedAbortSignal,
    onStepFinish: async (step) => {
      if (lastPreparedWorkflowActionV2) {
        currentWorkflowStateV2 = applyWorkflowTransitionV2({
          state: currentWorkflowStateV2,
          action: lastPreparedWorkflowActionV2,
          toolExecution: getWorkflowToolExecutionV2({
            action: lastPreparedWorkflowActionV2,
            toolResults: (step.toolResults ?? []) as Array<{
              toolName?: string;
              output?: unknown;
              error?: unknown;
            }>,
          }),
          baseVersion: input.baseVersion,
          contextStatus: toolRuntime.getContextStatusSnapshot(
            getActiveGoalV2(currentWorkflowStateV2),
          ),
        });
        if (lastPreparedWorkflowActionV2.kind === "apply_patch") {
          runtimeApprovedProposalId = null;
        }
        lastPreparedWorkflowActionV2 = null;
      }
      currentTaskState = updateTaskStateFromToolStep({
        previous: currentTaskState,
        toolCalls: (step.toolCalls ?? []) as Array<{ toolName?: string; input?: unknown }>,
        toolResults: (step.toolResults ?? []) as Array<{
          toolName?: string;
          output?: unknown;
          error?: unknown;
        }>,
      });
      const usage = step.usage;
      const stepTokens =
        typeof usage.totalTokens === "number" && usage.totalTokens > 0
          ? usage.totalTokens
          : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      if (typeof stepTokens === "number" && stepTokens > 0) {
        cumulativeTokens += stepTokens;
      }
      if (cumulativeTokens >= tokenBudget) {
        budgetController.abort(new Error("authoring-turn-token-budget-exceeded"));
      }
    },
  });

  return {
    stream: createUIMessageStream({
      originalMessages: input.messages,
      onStepFinish: input.onStepFinish,
      onFinish: async (payload) => {
        clearTimeout(wallTimer);
        await input.onFinish?.(payload);
      },
      execute: ({ writer }) => {
        writer.write({
          type: "data-authoring_scope",
          data: {
            ...initialDecision,
            contextFingerprint: contextBlock.fingerprint,
            lockedProfile: turnLockedProfile,
            taskState: currentTaskState,
          },
        });
        if (input.checks?.length) {
          writer.write({
            type: "data-authoring_checks",
            data: input.checks,
          });
        }
        writer.merge(agentStream);
      },
    }),
    getDraftSnapshot: toolRuntime.getDraftSnapshot,
    getLastRunCheckStateSnapshot: toolRuntime.getLastRunCheckStateSnapshot,
    getTaskStateSnapshot: () => currentTaskState,
    getWorkflowStateV2Snapshot: () => currentWorkflowStateV2,
    getRejectedProposalIdSnapshot: () => rejectedProposalIdV2,
    contextFingerprint: contextBlock.fingerprint,
  };
}
