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
import type { AuthoringMode } from "@/ai/authoring/types";
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

const DEFAULT_WALL_CLOCK_MS = 60_000;
const DEFAULT_TURN_TOKEN_BUDGET = 32_000;
const MAX_INLINE_SKILLS = 2;
const MAX_SKILL_BODY_CHARS = 3000;

export type ExpandedSkillContent = { id: string; content: string };

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
  /**
   * Loads raw SKILL.md body for a skill id (used to inline strongly matched
   * skills into the system prompt).
   */
  loadSkillBody?: (skillId: string) => Promise<string | null>;
  /** Max wall-clock time for this turn (ms). Default 60_000. */
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
    currentTaskState = {
      ...currentTaskState,
      phase: "drafting",
      updatedAt: new Date().toISOString(),
    };
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

  const expandedSkills: ExpandedSkillContent[] = [];
  if (
    input.loadSkillBody &&
    initialDecision.relevantSkillIds.length > 0 &&
    initialDecision.relevantSkillIds.length <= MAX_INLINE_SKILLS
  ) {
    for (const skillId of initialDecision.relevantSkillIds) {
      const body = await input.loadSkillBody(skillId);
      if (body) {
        expandedSkills.push({
          id: skillId,
          content: body.slice(0, MAX_SKILL_BODY_CHARS),
        });
      }
    }
  }

  const wallMs = input.wallClockTimeoutMs ?? DEFAULT_WALL_CLOCK_MS;
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
    proposalSummary: initialLatestDraft
      ? {
          proposal_id: initialLatestDraft.suggestion.id,
          summary: initialLatestDraft.suggestion.summary,
          operation_count: initialLatestDraft.suggestion.patch.operations.length,
        }
      : null,
  });
  const modelMessages = injectAuthoringContext({
    messages: redactSupersededToolOutputs(input.messages),
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
      expandedSkills,
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
          outcome: (step.toolResults ?? []).some(
            (result) =>
              result.toolName === call.toolName &&
              !(
                typeof result === "object" &&
                result !== null &&
                "error" in result &&
                result.error !== undefined
              ),
          )
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
      const activeTools = decision.activeTools;
      const toolChoice = decision.toolChoice;

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
          mutationsApplied: allMutationsThisTurn.length,
          lockedMode: turnLockedMode,
          taskState: currentTaskState,
        },
      );

      return {
        messages: preparedMessages,
        system: buildAuthoringSystemPrompt({
          sections: decision.systemPromptSections,
          scope: decision.scope,
          skills: input.skills,
          relevantSkillIds: decision.relevantSkillIds,
          taskState: currentTaskState,
          expandedSkills,
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
