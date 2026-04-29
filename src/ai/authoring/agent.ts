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
import { resolveProviderModelConfig } from "@/ai/providers";
import type {
  AuthoringIntent,
  AuthoringMessage,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  DraftStatusToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringMode, AuthoringToolChoice } from "@/ai/authoring/types";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringTaskStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session-state";
import type { AuthoringDependencies } from "@/ai/authoring/engine/dependencies";
import { buildAuthoringTools } from "@/ai/authoring/tools";
import { buildAuthoringSystemPrompt } from "@/ai/authoring/prompt";
import { computeAuthoringScope } from "@/ai/authoring/scope";
import { buildViewListSummary } from "@/ai/authoring/context/context-summary";
import { buildAuthoringContextBlock } from "@/ai/authoring/context/context-block";
import { injectAuthoringContext } from "@/ai/authoring/context/inject-context";
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
} from "@/ai/authoring/engine/dependencies";
import {
  deriveConversationSignalsFromModelMessages,
  deriveConversationSignalsFromUiMessages,
} from "@/ai/authoring/messages/conversation-signals";
import { invalidateMutatedModelMessages } from "@/ai/authoring/messages/model-message-mutation";
import { findLatestDraftOutput } from "@/ai/authoring/messages/inspection";
import { sanitizeAuthoringMessages } from "@/ai/authoring/messages/ui-message-sanitize";
import { buildRepairToolPrompt } from "@/ai/authoring/repair";
import {
  updateTaskStateFromUserTurn,
  updateTaskStateFromToolStep,
} from "@/ai/authoring/task-state";
import {
  deriveAuthoringLifecycleDecision,
} from "@/ai/authoring/draft-completion";
import {
  applyWorkflowTransitionV2,
  createGoalFromIntentV2,
  decideNextActionV2,
  inspectArtifactsV2,
  prepareForcedToolStepV2,
  resolveIntentV2,
  type ApprovalStateV2,
  type ArtifactStatusV2,
  type TurnIntentV2,
  type WorkflowActionV2,
  type WorkflowStateV2,
} from "@/ai/authoring/v2";

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

function resolveAgentTurnIntentV2(input: {
  explicitIntent?: AuthoringIntent | null;
  latestUserText?: string | null;
}): TurnIntentV2 | null {
  if (input.explicitIntent === "apply" || input.explicitIntent === "cancel") {
    return null;
  }
  if (input.explicitIntent === "explore") {
    return { kind: "explore_data", scope: "datasources" };
  }
  if (input.explicitIntent === "ask-capability") {
    return { kind: "chat" };
  }
  return resolveIntentV2({ latestUserText: input.latestUserText });
}

function withTaskDataModeV2(input: {
  intent: TurnIntentV2 | null;
  taskState: AuthoringTaskStateSnapshot;
}): TurnIntentV2 | null {
  if (input.intent?.kind !== "create_view" || input.intent.goal.dataMode) {
    return input.intent;
  }
  const dataMode = input.taskState.dataMode;
  if (dataMode !== "live" && dataMode !== "mock" && dataMode !== "undecided") {
    return input.intent;
  }
  return {
    ...input.intent,
    goal: {
      ...input.intent.goal,
      dataMode,
    },
  };
}

function buildInitialWorkflowStateV2(input: {
  intent: TurnIntentV2 | null;
  taskState: AuthoringTaskStateSnapshot;
  sessionId?: string;
  pendingProposalId?: string | null;
}): WorkflowStateV2 {
  const goal = input.intent
    ? createGoalFromIntentV2({
        intent: input.intent,
        turnId: input.sessionId ?? "turn",
        selectedDatasourceId: input.taskState.selectedDataContext?.datasourceId,
        selectedTable: input.taskState.selectedDataContext?.tableName,
      })
    : null;
  return {
    activeGoal: goal,
    ...(input.pendingProposalId ? { pendingProposalId: input.pendingProposalId } : {}),
  };
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
  if (input.draftStatus.next_required_action === "run_check") {
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
): ApprovalStateV2 {
  return {
    ...(workflowState.pendingProposalId
      ? { pendingProposalId: workflowState.pendingProposalId }
      : {}),
    userApproved: false,
    source: "none",
  };
}

function isSupportedCreateViewChartV2(intent: TurnIntentV2, state: WorkflowStateV2) {
  if (intent.kind !== "create_view") {
    return false;
  }
  const chartType = state.activeGoal?.chartPlan?.chartType;
  return chartType === "line" || chartType === "bar" || chartType === "kpi";
}

function shouldUseWorkflowActionV2(input: {
  intent: TurnIntentV2 | null;
  state: WorkflowStateV2;
  action: WorkflowActionV2;
}): boolean {
  if (!input.intent) {
    return false;
  }
  if (input.intent.kind === "explore_data" || input.intent.kind === "approve_patch_text") {
    return true;
  }
  if (!isSupportedCreateViewChartV2(input.intent, input.state)) {
    return false;
  }
  if (
    input.action.kind === "prepare_query_context" &&
    !input.state.activeGoal?.targetRefs.datasourceId
  ) {
    return false;
  }
  return true;
}

function getToolResultOutput(input: {
  action: WorkflowActionV2;
  toolResults?: Array<{ toolName?: string; output?: unknown }>;
}): unknown {
  const toolName = "tool" in input.action ? input.action.tool : null;
  if (!toolName) {
    return undefined;
  }
  const result = input.toolResults?.find(
    (candidate) => candidate.toolName === toolName,
  );
  return result?.output;
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
  lockedMode?: AuthoringMode | null;
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
    lockedMode: input.lockedMode ?? null,
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
  sessionId?: string;
  abortSignal?: AbortSignal;
  dependencies?: AuthoringDependencies;
  /** Optional UI-declared intent forwarded to the scope layer. */
  intent?: AuthoringIntent | null;
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
      lockedMode: null,
    }),
  );
  const turnLockedMode = initialDecision.mode;
  let currentTurnIntentV2 = withTaskDataModeV2({
    intent: resolveAgentTurnIntentV2({
      explicitIntent: input.intent,
      latestUserText: initialConversation.latestUserText,
    }),
    taskState: currentTaskState,
  });
  let currentWorkflowStateV2 = buildInitialWorkflowStateV2({
    intent: currentTurnIntentV2,
    taskState: currentTaskState,
    sessionId: input.sessionId,
    pendingProposalId: initialLatestDraft?.suggestion.id,
  });
  let lastPreparedWorkflowActionV2: WorkflowActionV2 | null = null;

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
    getActiveGoalId: () => currentWorkflowStateV2.activeGoal?.id ?? null,
  });
  const initialDraftStatus = toolRuntime.getDraftStatusSnapshot();
  const initialLifecycleDecision = deriveAuthoringLifecycleDecision({
    tools: initialDecision.activeTools,
    conversation: initialConversation,
    draftStatus: initialDraftStatus,
    lastFailedToolName: currentTaskState.lastFailedTool?.toolName,
  });
  if (currentTaskState.phase !== initialLifecycleDecision.phase) {
    currentTaskState = {
      ...currentTaskState,
      phase: initialLifecycleDecision.phase,
    };
  }
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
    lifecycle: initialLifecycleDecision,
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
      sections: initialDecision.systemPromptSections,
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
          lockedMode: turnLockedMode,
        }),
      );
      const draftStatus = toolRuntime.getDraftStatusSnapshot();
      const lifecycleDecision = deriveAuthoringLifecycleDecision({
        tools: decision.activeTools,
        conversation,
        draftStatus,
        stepHistoryInTurn: stepHistory,
        lastFailedToolName: currentTaskState.lastFailedTool?.toolName,
      });
      currentTurnIntentV2 = withTaskDataModeV2({
        intent: currentTurnIntentV2,
        taskState: currentTaskState,
      });
      const draftSnapshot = toolRuntime.getDraftSnapshot();
      const artifactStatusV2 = inspectArtifactsV2({
        goal: currentWorkflowStateV2.activeGoal,
        candidate: toolRuntime.getCandidateDocumentSnapshot(),
        ownership: draftSnapshot?.ownership,
        runtimeCheck: buildRuntimeCheckStatusV2({
          draftStatus,
          taskState: currentTaskState,
        }),
        pendingProposalId: currentWorkflowStateV2.pendingProposalId,
      });
      const workflowActionV2 = currentTurnIntentV2
        ? decideNextActionV2({
            intent: currentTurnIntentV2,
            workflowState: currentWorkflowStateV2,
            contextStatus: toolRuntime.getContextStatusSnapshot(
              currentWorkflowStateV2.activeGoal,
            ),
            artifactStatus: artifactStatusV2,
            approvalState: buildApprovalStateV2(currentWorkflowStateV2),
          })
        : null;
      if (workflowActionV2?.kind === "block_goal") {
        currentWorkflowStateV2 = applyWorkflowTransitionV2({
          state: currentWorkflowStateV2,
          action: workflowActionV2,
        });
      }
      const forcedStepV2 =
        workflowActionV2 &&
        shouldUseWorkflowActionV2({
          intent: currentTurnIntentV2,
          state: currentWorkflowStateV2,
          action: workflowActionV2,
        })
          ? prepareForcedToolStepV2(workflowActionV2)
          : null;
      const stepTaskState =
        currentTaskState.phase === lifecycleDecision.phase
          ? currentTaskState
          : {
              ...currentTaskState,
              phase: lifecycleDecision.phase,
            };
      const activeTools = forcedStepV2?.activeTools ?? lifecycleDecision.activeTools;
      const toolChoice: AuthoringToolChoice =
        forcedStepV2?.toolChoice ?? lifecycleDecision.toolChoice;
      lastPreparedWorkflowActionV2 =
        forcedStepV2 && workflowActionV2 && "tool" in workflowActionV2
          ? workflowActionV2
          : null;

      await writeAuthoringTrace(
        input.dependencies,
        "authoring-agent",
        "prepare-step",
        {
          sessionId: input.sessionId,
          stepNumber,
          mode: decision.mode,
          scope: decision.scope,
          activeTools,
          toolChoice,
          lifecycleDecision,
          workflowV2: workflowActionV2
            ? {
                intent: currentTurnIntentV2,
                action: workflowActionV2,
                forced: Boolean(forcedStepV2),
                state: currentWorkflowStateV2,
                artifactStatus: artifactStatusV2,
              }
            : null,
          mutationsApplied: allMutationsThisTurn.length,
          lockedMode: turnLockedMode,
          taskState: stepTaskState,
          draftStatus,
        },
      );

      return {
        messages: preparedMessages,
        system: buildAuthoringSystemPrompt({
          sections: decision.systemPromptSections,
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
          toolResult: getToolResultOutput({
            action: lastPreparedWorkflowActionV2,
            toolResults: (step.toolResults ?? []) as Array<{
              toolName?: string;
              output?: unknown;
            }>,
          }),
        });
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
            lockedMode: turnLockedMode,
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
    contextFingerprint: contextBlock.fingerprint,
  };
}
