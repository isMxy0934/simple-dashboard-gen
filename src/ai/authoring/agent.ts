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
        toolCall.toolName !== "upsertBinding"
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
              : (
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
      const stepTaskState =
        currentTaskState.phase === lifecycleDecision.phase
          ? currentTaskState
          : {
              ...currentTaskState,
              phase: lifecycleDecision.phase,
            };
      const activeTools = lifecycleDecision.activeTools;
      const toolChoice: AuthoringToolChoice = lifecycleDecision.toolChoice;

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
