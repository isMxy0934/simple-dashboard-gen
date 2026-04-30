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
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringCapabilityProfile,
  AuthoringScope,
  AuthoringToolChoice,
} from "@/ai/authoring/contracts/runtime";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import { buildAuthoringTools } from "@/ai/authoring/tools/factory";
import { buildAuthoringSystemPrompt } from "@/ai/authoring/messages/system-prompt";
import { computeAuthoringScope } from "@/ai/authoring/runtime/capability-scope";
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
  getInspectLaneToolNames,
  isCanonicalAuthoringToolName,
} from "@/ai/authoring/tools/registry";
import {
  applyWorkflowTransitionV2,
  decideNextActionV2,
  getActiveGoalV2,
  inspectArtifactsV2,
  normalizeWorkflowStateV2,
  prepareToolStepV2,
  reduceIntentToWorkflowStateV2,
} from "@/ai/authoring/v2";
import type {
  TurnIntentV2,
  WorkflowActionV2,
  WorkflowStateV2,
} from "@/ai/authoring/v2/types";
import {
  buildApprovalStateV2,
  buildRuntimeCheckStatusV2,
  declarationToTurnIntentV2,
  explicitEventIntentV2,
  getWorkflowToolExecutionV2,
  isSemanticToolResultError,
  isWorkflowActiveV2,
  resumeIntentForGoalV2,
} from "@/ai/authoring/agent/workflow-bridge";
import {
  defaultPromptSectionsForCapabilityProfile,
  promptSectionsForWorkflowAction,
} from "@/ai/authoring/agent/prompt-sections";
import {
  combineAbortSignals,
  findPseudoFunctionCall,
} from "@/ai/authoring/agent/tool-protocol";
import { buildScopeInput } from "@/ai/authoring/agent/scope-input";

const DEFAULT_WALL_CLOCK_MS = 60_000;
const DEFAULT_REASONING_WALL_CLOCK_MS = 180_000;
const DEFAULT_TURN_TOKEN_BUDGET = 32_000;
type AgentModeV2 = "inspect" | "workflow";

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
  initialWorkflowStateV2?: WorkflowStateV2 | null;
  sessionId?: string;
  turnId?: string;
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
  /**
   * Signals that one or more server-side resources failed to load before this
   * turn started. The agent will surface the failure to the user and, where
   * possible, attempt recovery via tool calls (e.g. calling getDatasources).
   */
  loadFailures?: { datasources?: boolean; skills?: boolean } | null;
  onStepFinish?: UIMessageStreamOnStepFinishCallback<AuthoringMessage>;
  onFinish?: UIMessageStreamOnFinishCallback<AuthoringMessage>;
}) {
  const runtime = resolveProviderModelConfig();
  if (!input.dependencies) {
    throw new Error("Authoring dependencies are required to create the agent stream.");
  }
  const initialConversation = deriveConversationSignalsFromUiMessages(input.messages);
  const initialLatestDraft = findLatestDraftOutput(input.messages);
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
  const recordTokenUsage = (
    usage:
      | {
          totalTokens?: number | null;
          inputTokens?: number | null;
          outputTokens?: number | null;
        }
      | null
      | undefined,
  ) => {
    if (!usage) {
      return;
    }
    const tokens =
      typeof usage.totalTokens === "number" && usage.totalTokens > 0
        ? usage.totalTokens
        : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    if (typeof tokens === "number" && tokens > 0) {
      cumulativeTokens += tokens;
    }
    if (cumulativeTokens >= tokenBudget) {
      budgetController.abort(new Error("authoring-turn-token-budget-exceeded"));
    }
  };

  const explicitWorkflowIntentV2 = explicitEventIntentV2(input.approvalEvent);
  let currentWorkflowStateV2 = normalizeWorkflowStateV2(reduceIntentToWorkflowStateV2({
    state: input.initialWorkflowStateV2,
    intent: explicitWorkflowIntentV2,
    turnId: input.turnId ?? input.sessionId ?? "turn",
    pendingProposalId: initialLatestDraft?.suggestion.id,
    pendingProposalBaseVersion: initialLatestDraft?.base_version ?? input.baseVersion,
    pendingProposalDraftFingerprint: initialLatestDraft?.draft_fingerprint,
  }));
  let currentWorkflowIntentV2: TurnIntentV2 | null =
    explicitWorkflowIntentV2 ?? resumeIntentForGoalV2(getActiveGoalV2(currentWorkflowStateV2));
  let agentModeV2: AgentModeV2 = isWorkflowActiveV2(currentWorkflowStateV2)
    ? "workflow"
    : "inspect";
  let lastPreparedWorkflowActionV2: WorkflowActionV2 | null = null;
  let runtimeApprovedProposalId: string | null = null;
  let rejectedProposalIdV2: string | null = null;
  await writeAuthoringTrace(
    input.dependencies,
    "authoring-agent",
    "turn_start",
    {
      sessionId: input.sessionId,
      mode: agentModeV2,
      hasActiveGoal: Boolean(getActiveGoalV2(currentWorkflowStateV2)),
      hasPendingProposal: Boolean(currentWorkflowStateV2.pendingProposalId),
      explicitIntent: input.intent ?? null,
      approvalEvent: input.approvalEvent
        ? {
            proposalId: input.approvalEvent.proposalId,
            decision: input.approvalEvent.decision,
            baseVersion: input.approvalEvent.baseVersion,
          }
        : null,
    },
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
    getActiveGoalId: () => getActiveGoalV2(currentWorkflowStateV2)?.id ?? null,
    getActiveGoal: () => getActiveGoalV2(currentWorkflowStateV2),
    getBaseVersion: () => input.baseVersion,
    onDeclareAuthoringGoal: async (declaration) => {
      const declaredIntent = declarationToTurnIntentV2(declaration);
      currentWorkflowStateV2 = normalizeWorkflowStateV2(reduceIntentToWorkflowStateV2({
        state: currentWorkflowStateV2,
        intent: declaredIntent,
        turnId: input.turnId ?? input.sessionId ?? "turn",
        pendingProposalId: initialLatestDraft?.suggestion.id,
        pendingProposalBaseVersion: initialLatestDraft?.base_version ?? input.baseVersion,
        pendingProposalDraftFingerprint: initialLatestDraft?.draft_fingerprint,
      }));
      currentWorkflowIntentV2 = declaredIntent;
      agentModeV2 = "workflow";
      const activeGoal = getActiveGoalV2(currentWorkflowStateV2);
      await writeAuthoringTrace(
        input.dependencies,
        "authoring-agent",
        "goal_declared",
        {
          sessionId: input.sessionId,
          declaredIntentKind: declaredIntent.kind,
          activeGoalId: activeGoal?.id ?? null,
          activeGoalStatus: activeGoal?.status ?? null,
          activeGoalKind: activeGoal?.kind ?? null,
          chartSkillId: activeGoal?.chartPlan?.chartSkillId ?? null,
          requestedChartLabel: activeGoal?.chartPlan?.requestedChartLabel ?? null,
        },
      );
      return {
        accepted: Boolean(activeGoal),
        declaredIntentKind: declaration.kind,
        ...(activeGoal ? { activeGoalId: activeGoal.id } : {}),
        message: activeGoal
          ? "Authoring goal declared. The V2 workflow runtime will choose the next required step."
          : "No active authoring goal was created from the declaration.",
      };
    },
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
    candidateFingerprint: toolRuntime.getCandidateDocumentFingerprintSnapshot(),
    ownership: initialDraftSnapshot?.ownership,
    runtimeCheck: buildRuntimeCheckStatusV2({
      draftStatus: initialDraftStatus,
      goal: getActiveGoalV2(currentWorkflowStateV2),
    }),
    pendingProposalId: currentWorkflowStateV2.pendingProposalId,
    pendingProposalDraftFingerprint: currentWorkflowStateV2.pendingProposalDraftFingerprint,
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
      sections: agentModeV2 === "workflow"
        ? defaultPromptSectionsForCapabilityProfile(initialDecision.profile)
        : ["identity", "inspect"],
      scope: initialDecision.scope,
      skills: input.skills,
      relevantSkillIds: initialDecision.relevantSkillIds,
      draftStatus: initialDraftStatus,
      loadFailures: input.loadFailures,
    }),
    tools: toolRuntime.tools,
    providerOptions: runtime.providerOptions,
    ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
    stopWhen: stepCountIs(20),
    experimental_repairToolCall: async ({ toolCall, inputSchema, error }) => {
      const expectedTool =
        lastPreparedWorkflowActionV2 && "tool" in lastPreparedWorkflowActionV2
          ? lastPreparedWorkflowActionV2.tool
          : null;
      if (!isCanonicalAuthoringToolName(toolCall.toolName)) {
        await writeAuthoringTrace(
          input.dependencies,
          "authoring-agent",
          "tool_protocol_error",
          {
            sessionId: input.sessionId,
            reason: "non_canonical_tool_name",
            toolName: toolCall.toolName,
            expectedTool,
            validationError: error.message,
          },
        );
        return null;
      }
      if (expectedTool && toolCall.toolName !== expectedTool) {
        await writeAuthoringTrace(
          input.dependencies,
          "authoring-agent",
          "tool_protocol_error",
          {
            sessionId: input.sessionId,
            reason: "tool_not_selected_by_workflow",
            toolName: toolCall.toolName,
            expectedTool,
            validationError: error.message,
          },
        );
        return null;
      }
      if (
        toolCall.toolName !== "upsertQuery" &&
        toolCall.toolName !== "upsertView" &&
        toolCall.toolName !== "upsertBinding" &&
        toolCall.toolName !== "upsertLayout"
      ) {
        await writeAuthoringTrace(
          input.dependencies,
          "authoring-agent",
          "tool_protocol_error",
          {
            sessionId: input.sessionId,
            reason: "tool_input_repair_not_supported",
            toolName: toolCall.toolName,
            expectedTool,
            validationError: error.message,
          },
        );
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
        candidateFingerprint: toolRuntime.getCandidateDocumentFingerprintSnapshot(),
        ownership: draftSnapshot?.ownership,
        runtimeCheck: buildRuntimeCheckStatusV2({
          draftStatus,
          goal: getActiveGoalV2(currentWorkflowStateV2),
        }),
        pendingProposalId: currentWorkflowStateV2.pendingProposalId,
        pendingProposalDraftFingerprint: currentWorkflowStateV2.pendingProposalDraftFingerprint,
      });
      let contextStatusV2 = toolRuntime.getContextStatusSnapshot(
        getActiveGoalV2(currentWorkflowStateV2),
      );
      agentModeV2 = isWorkflowActiveV2(currentWorkflowStateV2) ? "workflow" : "inspect";
      let scopedWorkflowActionV2: WorkflowActionV2 | null = null;
      let toolStepV2: ReturnType<typeof prepareToolStepV2> | null = null;
      let activeTools = getInspectLaneToolNames();
      let toolChoice: AuthoringToolChoice = "auto";
      let systemPromptSections = ["identity", "inspect"];

      if (agentModeV2 === "workflow") {
        currentWorkflowIntentV2 =
          currentWorkflowIntentV2 ?? resumeIntentForGoalV2(getActiveGoalV2(currentWorkflowStateV2));
        scopedWorkflowActionV2 = { kind: "answer", reason: "missing_turn_intent" };
        for (let guard = 0; guard < 10; guard++) {
          const workflowActionV2 = currentWorkflowIntentV2
            ? decideNextActionV2({
                intent: currentWorkflowIntentV2,
                workflowState: currentWorkflowStateV2,
                contextStatus: contextStatusV2,
                artifactStatus: artifactStatusV2,
                approvalState: buildApprovalStateV2(
                  currentWorkflowStateV2,
                  input.approvalEvent,
                ),
                toolAvailability: {
                  scopedTools: decision.allowedTools,
                  scope: decision.scope,
                  intent: currentWorkflowIntentV2,
                },
              })
            : null;
          scopedWorkflowActionV2 = workflowActionV2 ?? { kind: "answer", reason: "missing_turn_intent" };
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
            candidateFingerprint: toolRuntime.getCandidateDocumentFingerprintSnapshot(),
            ownership: draftSnapshot?.ownership,
            runtimeCheck: buildRuntimeCheckStatusV2({
              draftStatus,
              goal: getActiveGoalV2(currentWorkflowStateV2),
            }),
            pendingProposalId: currentWorkflowStateV2.pendingProposalId,
            pendingProposalDraftFingerprint: currentWorkflowStateV2.pendingProposalDraftFingerprint,
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
        toolStepV2 = prepareToolStepV2(scopedWorkflowActionV2);
        activeTools = toolStepV2.activeTools;
        toolChoice = toolStepV2.toolChoice;
        runtimeApprovedProposalId =
          scopedWorkflowActionV2.kind === "apply_patch"
            ? currentWorkflowStateV2.pendingProposalId ?? null
            : runtimeApprovedProposalId;
        systemPromptSections = promptSectionsForWorkflowAction({
          action: scopedWorkflowActionV2,
          intent: currentWorkflowIntentV2,
          defaultSections: defaultPromptSectionsForCapabilityProfile(decision.profile),
        });
      }
      lastPreparedWorkflowActionV2 =
        scopedWorkflowActionV2 && "tool" in scopedWorkflowActionV2
          ? scopedWorkflowActionV2
          : null;

      await writeAuthoringTrace(
        input.dependencies,
        "authoring-agent",
        "prepare-step",
        {
          sessionId: input.sessionId,
          stepNumber,
          mode: agentModeV2,
          capabilityProfile: decision.profile,
          scope: decision.scope,
          activeTools,
          toolChoice,
          workflowV2: {
            intent: currentWorkflowIntentV2,
            action: scopedWorkflowActionV2,
            toolStep: toolStepV2,
            state: currentWorkflowStateV2,
            artifactStatus: artifactStatusV2,
          },
          mutationsApplied: allMutationsThisTurn.length,
          lockedProfile: turnLockedProfile,
          draftStatus,
        },
      );
      await writeAuthoringTrace(
        input.dependencies,
        "authoring-agent",
        agentModeV2 === "workflow" ? "workflow_decision" : "inspect_decision",
        {
          sessionId: input.sessionId,
          stepNumber,
          mode: agentModeV2,
          activeTools,
          toolChoice,
          actionKind: scopedWorkflowActionV2?.kind ?? null,
          toolName: scopedWorkflowActionV2 && "tool" in scopedWorkflowActionV2
            ? scopedWorkflowActionV2.tool
            : null,
          activeGoalId: getActiveGoalV2(currentWorkflowStateV2)?.id ?? null,
          activeGoalStatus: getActiveGoalV2(currentWorkflowStateV2)?.status ?? null,
          chartSkillId:
            getActiveGoalV2(currentWorkflowStateV2)?.chartPlan?.chartSkillId ?? null,
          requestedChartLabel:
            getActiveGoalV2(currentWorkflowStateV2)?.chartPlan?.requestedChartLabel ?? null,
          context: {
            datasourcesLoaded: contextStatusV2.datasourcesLoaded,
            availableChartSkillIds: contextStatusV2.availableChartSkillIds,
            chartSkillLoadedFor: contextStatusV2.chartSkillLoadedFor
              ? {
                  skillId: contextStatusV2.chartSkillLoadedFor.skillId,
                }
              : null,
            schemaLoadedFor: contextStatusV2.schemaLoadedFor
              ? {
                  datasourceId: contextStatusV2.schemaLoadedFor.datasourceId,
                  table: contextStatusV2.schemaLoadedFor.table ?? null,
                }
              : null,
          },
          artifacts: {
            query: artifactStatusV2.query.valid,
            view: artifactStatusV2.view.valid,
            binding: artifactStatusV2.binding.valid,
            layout: artifactStatusV2.layout.valid,
            runtimeCheck: artifactStatusV2.runtimeCheck.status,
            patchComposed: artifactStatusV2.patch.composed,
            patchStale: artifactStatusV2.patch.stale,
          },
        },
      );

      return {
        messages: preparedMessages,
        system: buildAuthoringSystemPrompt({
          sections: systemPromptSections,
          scope: decision.scope,
          skills: input.skills,
          relevantSkillIds: decision.relevantSkillIds,
          draftStatus,
          loadFailures: input.loadFailures,
        }),
        activeTools,
        toolChoice,
      } as never;
    },
  });

  let agentStream: Awaited<ReturnType<typeof createAgentUIStream>>;
  try {
    agentStream = await createAgentUIStream({
      agent,
      uiMessages: modelMessages,
      originalMessages: input.messages as never,
      abortSignal: combinedAbortSignal,
      onStepFinish: async (step) => {
        if (lastPreparedWorkflowActionV2) {
          const toolExecution = getWorkflowToolExecutionV2({
            action: lastPreparedWorkflowActionV2,
            toolResults: (step.toolResults ?? []) as Array<{
              toolName?: string;
              output?: unknown;
              error?: unknown;
            }>,
          });
          if (
            toolExecution.status === "failed" &&
            toolExecution.reason === "missing_result"
          ) {
            await writeAuthoringTrace(
              input.dependencies,
              "authoring-agent",
              "forced_tool_missing_result",
              {
                sessionId: input.sessionId,
                actionKind: lastPreparedWorkflowActionV2.kind,
                toolName: "tool" in lastPreparedWorkflowActionV2
                  ? lastPreparedWorkflowActionV2.tool
                  : null,
                message: toolExecution.message,
              },
            );
          }
          currentWorkflowStateV2 = applyWorkflowTransitionV2({
            state: currentWorkflowStateV2,
            action: lastPreparedWorkflowActionV2,
            toolExecution,
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
        await writeAuthoringTrace(
          input.dependencies,
          "authoring-agent",
          "agent_step_finish",
          {
            sessionId: input.sessionId,
            mode: agentModeV2,
            toolCalls: (step.toolCalls ?? []).map((call) => ({
              toolName: call.toolName,
            })),
            toolResults: (step.toolResults ?? []).map((result) => ({
              toolName: result.toolName,
              hasError: ("error" in result && result.error !== undefined) ||
                isSemanticToolResultError({
                  toolName: result.toolName,
                  result,
                }),
            })),
          activeGoalId: getActiveGoalV2(currentWorkflowStateV2)?.id ?? null,
          activeGoalStatus: getActiveGoalV2(currentWorkflowStateV2)?.status ?? null,
          chartSkillId:
            getActiveGoalV2(currentWorkflowStateV2)?.chartPlan?.chartSkillId ?? null,
          requestedChartLabel:
            getActiveGoalV2(currentWorkflowStateV2)?.chartPlan?.requestedChartLabel ?? null,
          },
        );
        recordTokenUsage(step.usage);
      },
    });
  } catch (error) {
    clearTimeout(wallTimer);
    await writeAuthoringTrace(
      input.dependencies,
      "authoring-agent",
      "turn_error",
      {
        sessionId: input.sessionId,
        mode: agentModeV2,
        message: error instanceof Error ? error.message : String(error),
        activeGoalId: getActiveGoalV2(currentWorkflowStateV2)?.id ?? null,
        activeGoalStatus: getActiveGoalV2(currentWorkflowStateV2)?.status ?? null,
      },
    );
    throw error;
  }

  return {
    stream: createUIMessageStream({
      originalMessages: input.messages,
      onStepFinish: input.onStepFinish,
      onFinish: async (payload) => {
        clearTimeout(wallTimer);
        const pseudoFunctionToolName = findPseudoFunctionCall(payload.messages);
        if (pseudoFunctionToolName) {
          await writeAuthoringTrace(
            input.dependencies,
            "authoring-agent",
            "tool_protocol_error",
            {
              sessionId: input.sessionId,
              reason: "pseudo_function_text",
              toolName: pseudoFunctionToolName,
            },
          );
        }
        await writeAuthoringTrace(
          input.dependencies,
          "authoring-agent",
          "turn_finish",
          {
            sessionId: input.sessionId,
            mode: agentModeV2,
            activeGoalId: getActiveGoalV2(currentWorkflowStateV2)?.id ?? null,
            activeGoalStatus: getActiveGoalV2(currentWorkflowStateV2)?.status ?? null,
            cumulativeTokens,
            messageCount: payload.messages.length,
          },
        );
        await input.onFinish?.(payload);
      },
      execute: ({ writer }) => {
        writer.write({
          type: "data-authoring_scope",
          data: {
            ...initialDecision,
            contextFingerprint: contextBlock.fingerprint,
            lockedProfile: turnLockedProfile,
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
    getWorkflowStateV2Snapshot: () => currentWorkflowStateV2,
    getRejectedProposalIdSnapshot: () => rejectedProposalIdV2,
    contextFingerprint: contextBlock.fingerprint,
  };
}
