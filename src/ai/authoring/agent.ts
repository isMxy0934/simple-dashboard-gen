import {
  Agent,
  type AgentContext,
  type AgentMessage,
} from "@mariozechner/pi-agent-core";
import type { DashboardDocument } from "@/contracts";
import { resolveProviderModelConfig } from "@/ai/providers/index";
import type {
  AuthoringApprovalEvent,
  AuthoringIntent,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import { buildAuthoringTools } from "@/ai/authoring/tools/factory";
import { buildAuthoringSystemPrompt } from "@/ai/authoring/messages/system-prompt";
import { computeAuthoringScope } from "@/ai/authoring/runtime/capability-scope";
import { buildAuthoringContextBlock } from "@/ai/authoring/messages/context-block";
import {
  deriveConversationSignalsFromTranscript,
  findDraftOutputBySuggestionIdFromTranscript,
  findLatestDraftOutputFromTranscript,
} from "@/ai/authoring/runtime/transcript-inspection";
import { writeAuthoringTrace } from "@/ai/authoring/runtime/dependencies";
import {
  buildRuntimeCheckStatus,
  declarationToTurnIntent,
  explicitEventIntent,
  piToolResultToWorkflowExecution,
} from "@/ai/authoring/agent/workflow-bridge";
import { buildScopeInput } from "@/ai/authoring/agent/scope-input";
import { createAuthoringAgentEventStream } from "@/ai/authoring/agent/event-stream";
import {
  createAuthoringProviderSessionId,
  resolveAuthoringWallClockTimeout,
} from "@/ai/authoring/agent/provider-session";
import {
  assertProviderPayloadBoundary,
  inspectProviderPayloadBoundary,
} from "@/ai/authoring/agent/provider-payload-guard";
import type {
  AuthoringAgentFinishPayload,
  AuthoringAgentProtocolEvent,
} from "@/ai/authoring/agent/protocol";
import {
  applyWorkflowTransition,
  decideNextAction,
  getActiveGoal,
  inspectArtifacts,
  normalizeAuthoringWorkflowState,
  prepareToolStep,
  reduceIntentToAuthoringWorkflowState,
} from "@/ai/authoring/workflow";
import type {
  AuthoringWorkflowState,
  ToolStep,
  TurnIntent,
  WorkflowAction,
} from "@/ai/authoring/workflow/types";
import {
  convertToLlm,
  createAuthoringRuntimeInstructionMessage,
  sanitizeAgentMessages,
  transformAuthoringContext,
} from "@/ai/authoring/runtime/llm-boundary";
import { toPiAgentTools } from "@/ai/authoring/runtime/pi-tool-adapter";
import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import {
  buildInspectToolSurface,
  buildWorkflowToolSurface,
  normalizeActiveAuthoringToolName,
  selectAuthoringToolSet,
  type RuntimeToolSurface,
} from "@/ai/authoring/agent/tool-surface";

export type { AuthoringAgentFinishPayload, AuthoringAgentProtocolEvent };

function workflowIntentForCurrentTurn(input: {
  explicitWorkflowIntent: TurnIntent | null;
  workflowState: AuthoringWorkflowState;
}): TurnIntent | null {
  if (input.explicitWorkflowIntent) {
    return input.explicitWorkflowIntent;
  }
  return getActiveGoal(input.workflowState) ? { kind: "continue_workflow" } : null;
}

function isStateChangingTerminalAction(action: WorkflowAction): boolean {
  return (
    action.kind === "complete_goal" ||
    action.kind === "ask_user" ||
    action.kind === "block_goal" ||
    action.kind === "reject_patch"
  );
}

function workflowActionTool(action: WorkflowAction | null): AuthoringToolName | null {
  return action && "tool" in action ? action.tool : null;
}

function forcedToolRetryText(step: ToolStep): string {
  const toolName =
    step.toolChoice !== "auto" && step.toolChoice !== "none"
      ? step.toolChoice.toolName
      : step.activeTools[0];
  return [
    "Runtime instruction: the workflow selected one required tool for this step.",
    `Call ${toolName} now using the current context and active goal facts.`,
    "Do not answer conversationally unless the tool call fails validation.",
  ].join("\n");
}

export async function createAuthoringAgentStream(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  agentMessages?: AgentMessage[] | null;
  promptText?: string | null;
  initialWorkingDraft?: AuthoringWorkingDraftSnapshot | null;
  initialLastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  initialAuthoringWorkflowState?: AuthoringWorkflowState | null;
  sessionId?: string;
  turnId?: string;
  abortSignal?: AbortSignal;
  dependencies?: AuthoringDependencies;
  intent?: AuthoringIntent | null;
  baseVersion?: number;
  approvalEvent?: AuthoringApprovalEvent | null;
  wallClockTimeoutMs?: number;
  loadFailures?: { datasources?: boolean; skills?: boolean } | null;
  onFinish?: (payload: AuthoringAgentFinishPayload) => Promise<void> | void;
}) {
  const runtime = resolveProviderModelConfig();
  if (!input.dependencies) {
    throw new Error("Authoring dependencies are required to create the agent stream.");
  }

  const transcript = sanitizeAgentMessages(input.agentMessages ?? []);
  const promptText = (input.promptText ?? "").trim();
  const initialConversation =
    deriveConversationSignalsFromTranscript({
      messages: transcript,
      promptText,
      hasApprovalRequest: Boolean(input.approvalEvent),
      approvalDecision: input.approvalEvent?.decision ?? null,
    });
  const initialLatestDraft = initialConversation.latestDraftOutput;
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
    }),
  );

  const explicitWorkflowIntent = explicitEventIntent(input.approvalEvent);
  let currentAuthoringWorkflowState = normalizeAuthoringWorkflowState(reduceIntentToAuthoringWorkflowState({
    state: input.initialAuthoringWorkflowState,
    intent: explicitWorkflowIntent,
    turnId: input.turnId ?? input.sessionId ?? "turn",
    pendingProposalId: initialLatestDraft?.suggestion.id,
    pendingProposalBaseVersion: initialLatestDraft?.base_version ?? input.baseVersion,
    pendingProposalDraftFingerprint: initialLatestDraft?.draft_fingerprint,
  }));
  const getRuntimeApprovalContext = () => {
    const approvalEvent = input.approvalEvent;
    const pendingProposalId = currentAuthoringWorkflowState.pendingProposalId ?? null;
    const pendingProposalBaseVersion =
      currentAuthoringWorkflowState.pendingProposalBaseVersion ?? null;
    const proposalId =
      approvalEvent?.decision === "approve" ? approvalEvent.proposalId : null;
    const baseVersion =
      approvalEvent?.decision === "approve" ? approvalEvent.baseVersion : null;
    return {
      approved: Boolean(
        approvalEvent?.decision === "approve" &&
          proposalId &&
          pendingProposalId &&
          proposalId === pendingProposalId &&
          typeof baseVersion === "number" &&
          typeof pendingProposalBaseVersion === "number" &&
          baseVersion === pendingProposalBaseVersion &&
          currentAuthoringWorkflowState.pendingProposalDraftFingerprint,
      ),
      proposalId,
      baseVersion,
      pendingProposalId,
      pendingProposalBaseVersion,
      draftFingerprint:
        currentAuthoringWorkflowState.pendingProposalDraftFingerprint ?? null,
    };
  };

  await writeAuthoringTrace(
    input.dependencies,
    "authoring-agent",
    "turn_start",
    {
      sessionId: input.sessionId,
      mode: getActiveGoal(currentAuthoringWorkflowState) ? "workflow" : "inspect",
      hasActiveGoal: Boolean(getActiveGoal(currentAuthoringWorkflowState)),
      hasPendingProposal: Boolean(currentAuthoringWorkflowState.pendingProposalId),
      explicitIntent: input.intent ?? null,
      approvalEvent: input.approvalEvent ?? null,
    },
  );

  const toolRuntime = buildAuthoringTools({
    scope: initialDecision.scope,
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    skills: input.skills,
    checks: input.checks,
    initialWorkingDraft: input.initialWorkingDraft,
    dependencies: input.dependencies,
    initialLastRunCheckState: input.initialLastRunCheckState,
    findLatestDraftOutput: () => findLatestDraftOutputFromTranscript(transcript),
    findDraftOutputBySuggestionId: (suggestionId) =>
      findDraftOutputBySuggestionIdFromTranscript(transcript, suggestionId),
    getActiveGoalId: () => getActiveGoal(currentAuthoringWorkflowState)?.id ?? null,
    getActiveGoal: () => getActiveGoal(currentAuthoringWorkflowState),
    getBaseVersion: () => input.baseVersion,
    onDeclareAuthoringGoal: async (declaration) => {
      const declaredIntent = declarationToTurnIntent(declaration);
      currentAuthoringWorkflowState = normalizeAuthoringWorkflowState(reduceIntentToAuthoringWorkflowState({
        state: currentAuthoringWorkflowState,
        intent: declaredIntent,
        turnId: input.turnId ?? input.sessionId ?? "turn",
        pendingProposalId: initialLatestDraft?.suggestion.id,
        pendingProposalBaseVersion: initialLatestDraft?.base_version ?? input.baseVersion,
        pendingProposalDraftFingerprint: initialLatestDraft?.draft_fingerprint,
      }));
      const activeGoal = getActiveGoal(currentAuthoringWorkflowState);
      return {
        accepted: Boolean(activeGoal),
        declaredIntentKind: declaration.kind,
        ...(activeGoal ? { activeGoalId: activeGoal.id } : {}),
        message: activeGoal
          ? "Authoring goal declared. The workflow runtime will choose the next required step."
          : "No active authoring goal was created from the declaration.",
      };
    },
    getRuntimeApprovalContext,
  });

  const buildArtifactStatusSnapshot = () => {
    const draftStatus = toolRuntime.getDraftStatusSnapshot();
    const draftSnapshot = toolRuntime.getDraftSnapshot();
    const activeGoal = getActiveGoal(currentAuthoringWorkflowState);
    return inspectArtifacts({
      goal: activeGoal,
      candidate: toolRuntime.getCandidateDocumentSnapshot(),
      candidateFingerprint: toolRuntime.getCandidateDocumentFingerprintSnapshot(),
      ownership: draftSnapshot?.ownership,
      runtimeCheck: buildRuntimeCheckStatus({
        draftStatus,
        goal: activeGoal,
      }),
      pendingProposalId: currentAuthoringWorkflowState.pendingProposalId,
      pendingProposalDraftFingerprint:
        currentAuthoringWorkflowState.pendingProposalDraftFingerprint,
    });
  };

  const buildContextBlockSnapshot = () =>
    buildAuthoringContextBlock({
      variant: initialDecision.contextBlockVariant,
      dashboard: input.dashboard,
      dashboardId: input.dashboardId,
      focusedViewId:
        initialDecision.scope.kind === "focused"
          ? initialDecision.scope.viewId
          : input.focusedViewId,
      datasources: input.datasources,
      checks: input.checks,
      latestUserText: promptText || initialConversation.latestUserText,
      intent: input.intent ?? null,
      draftStatus: toolRuntime.getDraftStatusSnapshot(),
      workflowState: currentAuthoringWorkflowState,
      artifactStatus: buildArtifactStatusSnapshot(),
      scopeResolution: initialDecision.scopeResolution,
      proposalSummary: initialLatestDraft
        ? {
            proposal_id: initialLatestDraft.suggestion.id,
            summary: initialLatestDraft.suggestion.summary,
            operation_count: initialLatestDraft.suggestion.patch.operations.length,
          }
        : null,
    });

  let currentContextBlock = buildContextBlockSnapshot();

  const decideWorkflowActionForCurrentState = (): WorkflowAction | null => {
    const intent = workflowIntentForCurrentTurn({
      explicitWorkflowIntent,
      workflowState: currentAuthoringWorkflowState,
    });
    if (!intent) {
      return null;
    }
    return decideNextAction({
      intent,
      workflowState: currentAuthoringWorkflowState,
      contextStatus: toolRuntime.getContextStatusSnapshot(
        getActiveGoal(currentAuthoringWorkflowState),
      ),
      artifactStatus: buildArtifactStatusSnapshot(),
      approvalState: {
        pendingProposalId: currentAuthoringWorkflowState.pendingProposalId,
        pendingProposalBaseVersion:
          currentAuthoringWorkflowState.pendingProposalBaseVersion,
        source: input.approvalEvent ? "ui_event" : "none",
        userApproved: getRuntimeApprovalContext().approved,
      },
      toolAvailability: {
        scopedTools: initialDecision.allowedTools,
        scope: initialDecision.scope,
        intent,
      },
    });
  };

  const buildWorkflowSurfaceForCurrentState = (): RuntimeToolSurface => {
    let action = decideWorkflowActionForCurrentState();
    if (!action) {
      return buildInspectToolSurface({ scope: initialDecision.scope });
    }

    for (let guard = 0; guard < 8; guard += 1) {
      if (action.kind === "complete_goal") {
        currentAuthoringWorkflowState = applyWorkflowTransition({
          state: currentAuthoringWorkflowState,
          action,
          baseVersion: input.baseVersion,
          contextStatus: toolRuntime.getContextStatusSnapshot(
            getActiveGoal(currentAuthoringWorkflowState),
          ),
        });
        action = decideWorkflowActionForCurrentState();
        if (!action) {
          return buildInspectToolSurface({ scope: initialDecision.scope });
        }
        continue;
      }

      if (isStateChangingTerminalAction(action)) {
        currentAuthoringWorkflowState = applyWorkflowTransition({
          state: currentAuthoringWorkflowState,
          action,
          baseVersion: input.baseVersion,
          contextStatus: toolRuntime.getContextStatusSnapshot(
            getActiveGoal(currentAuthoringWorkflowState),
          ),
        });
      }
      const step = prepareToolStep(action);
      return buildWorkflowToolSurface({
        action,
        step,
        scope: initialDecision.scope,
      });
    }

    const step = prepareToolStep({
      kind: "block_goal",
      blocker: "workflow_loop",
      reason: "Workflow runtime could not settle the next action.",
    });
    return buildWorkflowToolSurface({
      action: {
        kind: "block_goal",
        blocker: "workflow_loop",
        reason: "Workflow runtime could not settle the next action.",
      },
      step,
      scope: initialDecision.scope,
    });
  };

  let currentSurface = buildWorkflowSurfaceForCurrentState();
  let currentActiveToolNames = new Set(currentSurface.activeTools);
  let forcedStepRetryUsed = false;

  const buildSystemPromptForSurface = (surface: RuntimeToolSurface) =>
    buildAuthoringSystemPrompt({
      sections: surface.promptSections,
      scope: initialDecision.scope,
      skills: input.skills,
      relevantSkillIds: initialDecision.relevantSkillIds,
      draftStatus: toolRuntime.getDraftStatusSnapshot(),
      loadFailures: input.loadFailures,
    });

  const buildPiToolsForSurface = (surface: RuntimeToolSurface) =>
    toPiAgentTools(
      selectAuthoringToolSet({
        tools: toolRuntime.tools,
        activeTools: surface.activeTools,
      }),
    );

  let activeAgent: Agent | null = null;

  const applySurfaceToRuntime = async (context?: AgentContext) => {
    currentContextBlock = buildContextBlockSnapshot();
    currentActiveToolNames = new Set(currentSurface.activeTools);
    const piTools = buildPiToolsForSurface(currentSurface);
    const systemPrompt = buildSystemPromptForSurface(currentSurface);
    if (activeAgent) {
      activeAgent.state.tools = piTools;
      activeAgent.state.systemPrompt = systemPrompt;
    }
    if (context) {
      context.tools = piTools;
      context.systemPrompt = systemPrompt;
    }
    await writeAuthoringTrace(
      input.dependencies!,
      "authoring-agent",
      "prepare-step",
      {
        sessionId: input.sessionId,
        mode: currentSurface.mode,
        actionKind: currentSurface.action?.kind ?? "inspect",
        activeTools: currentSurface.activeTools,
        toolChoice: currentSurface.toolChoice,
      },
    );
  };

  const refreshRuntimeSurface = async (context?: AgentContext) => {
    currentSurface = buildWorkflowSurfaceForCurrentState();
    forcedStepRetryUsed = false;
    await applySurfaceToRuntime(context);
  };

  await applySurfaceToRuntime();

  const agent = new Agent({
    initialState: {
      model: runtime.model,
      thinkingLevel: runtime.thinkingLevel,
      systemPrompt: buildSystemPromptForSurface(currentSurface),
      tools: buildPiToolsForSurface(currentSurface),
      messages: transcript,
    },
    sessionId: createAuthoringProviderSessionId(input.sessionId),
    getApiKey: runtime.getApiKey,
    thinkingBudgets: {
      minimal: 1024,
      low: 2048,
      medium: 4096,
      high: 8192,
    },
    transport: "sse",
    toolExecution: "sequential",
    transformContext: async (messages, signal) => {
      if (signal?.aborted) {
        return messages;
      }
      return transformAuthoringContext({
        messages,
        contextMarkdown: currentContextBlock.markdown,
      });
    },
    convertToLlm: async (messages) => convertToLlm(messages),
    beforeToolCall: async ({ toolCall }) => {
      const toolName = normalizeActiveAuthoringToolName(toolCall.name);
      if (!toolName || !currentActiveToolNames.has(toolName)) {
        return {
          block: true,
          reason: `Tool ${toolCall.name} is not active for the current workflow step.`,
        };
      }
      if (
        toolName === "applyPatch" &&
        currentSurface.action?.kind !== "apply_patch"
      ) {
        return {
          block: true,
          reason: "applyPatch is only available for a matching local UI approval event.",
        };
      }
      return undefined;
    },
    afterToolCall: async ({ toolCall, result, isError, context }) => {
      const toolName = normalizeActiveAuthoringToolName(toolCall.name);
      const actionForTool = workflowActionTool(currentSurface.action);
      if (toolName && actionForTool === toolName) {
        currentAuthoringWorkflowState = applyWorkflowTransition({
          state: currentAuthoringWorkflowState,
          action: currentSurface.action!,
          toolExecution: piToolResultToWorkflowExecution({ result, isError }),
          baseVersion: input.baseVersion,
          contextStatus: toolRuntime.getContextStatusSnapshot(
            getActiveGoal(currentAuthoringWorkflowState),
          ),
        });
      }
      await refreshRuntimeSurface(context);
      return undefined;
    },
    onPayload: async (payload) => {
      const inspection = inspectProviderPayloadBoundary(payload);
      await writeAuthoringTrace(
        input.dependencies!,
        "authoring-agent",
        "provider_payload",
        {
          sessionId: input.sessionId,
          provider: runtime.providerKind,
          containsProviderRuntimeMetadata: !inspection.safe,
          boundaryViolation: inspection.reason,
          boundaryViolationPath: inspection.path,
        },
      );
      assertProviderPayloadBoundary(payload);
      return undefined;
    },
  });
  activeAgent = agent;

  agent.subscribe(async (event) => {
    if (event.type !== "turn_end" || currentSurface.mode !== "forced") {
      return;
    }
    const targetTool = currentSurface.activeTools[0];
    if (!targetTool) {
      return;
    }
    const calledTargetTool = event.toolResults.some(
      (result) => result.toolName === targetTool,
    );
    if (calledTargetTool) {
      return;
    }
    const retryStep: ToolStep = {
      mode: "forced",
      activeTools: currentSurface.activeTools,
      toolChoice: currentSurface.toolChoice,
    };
    if (!forcedStepRetryUsed) {
      forcedStepRetryUsed = true;
      agent.followUp(createAuthoringRuntimeInstructionMessage(
        forcedToolRetryText(retryStep),
      ));
      return;
    }

    const blockAction: WorkflowAction = {
      kind: "block_goal",
      blocker: "required_tool_not_called",
      reason: `The workflow required ${targetTool}, but the assistant did not call it.`,
    };
    currentAuthoringWorkflowState = applyWorkflowTransition({
      state: currentAuthoringWorkflowState,
      action: blockAction,
      baseVersion: input.baseVersion,
      contextStatus: toolRuntime.getContextStatusSnapshot(
        getActiveGoal(currentAuthoringWorkflowState),
      ),
    });
    currentSurface = buildWorkflowToolSurface({
      action: blockAction,
      step: prepareToolStep(blockAction),
      scope: initialDecision.scope,
    });
    await applySurfaceToRuntime();
  });

  const stream = createAuthoringAgentEventStream({
    agent,
    promptText,
    sessionId: input.sessionId,
    abortSignal: input.abortSignal,
    wallClockTimeoutMs:
      input.wallClockTimeoutMs ?? resolveAuthoringWallClockTimeout(runtime),
    dependencies: input.dependencies,
    onFinish: input.onFinish,
  });

  return {
    stream,
    getAgentMessagesSnapshot: () => agent.state.messages,
    getDraftSnapshot: toolRuntime.getDraftSnapshot,
    getLastRunCheckStateSnapshot: toolRuntime.getLastRunCheckStateSnapshot,
    getAuthoringWorkflowStateSnapshot: () => currentAuthoringWorkflowState,
    get contextFingerprint() {
      return currentContextBlock.fingerprint;
    },
  };
}
