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
import {
  writeAuthoringLedgerEvent,
  writeAuthoringTrace,
} from "@/ai/authoring/runtime/dependencies";
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
import { summarizeProviderPayload } from "@/ai/authoring/agent/provider-observability";
import {
  buildPiEventLedgerEvent,
  buildProviderPayloadLedgerEvent,
  buildSurfaceLedgerEvent,
  type AuthoringAgentLedgerEvent,
} from "@/ai/authoring/agent/ledger";
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
} from "@/ai/authoring/workflow/index";
import type {
  AuthoringWorkflowState,
  ToolStep,
  WorkflowAction,
} from "@/ai/authoring/workflow/types";
import {
  convertToLlm,
  createAuthoringRuntimeInstructionMessage,
  sanitizeAgentMessages,
  transformAuthoringContext,
} from "@/ai/authoring/runtime/llm-boundary";
import { toPiAgentTools } from "@/ai/authoring/runtime/pi-tool-adapter";
import {
  buildWorkflowToolSurface,
  selectAuthoringToolSet,
  type RuntimeToolSurface,
} from "@/ai/authoring/agent/tool-surface";
import {
  buildRuntimeSurfaceForCurrentState,
  forcedToolRetryText,
  workflowIntentForCurrentTurn,
} from "@/ai/authoring/agent/runtime-surface";
import { buildAuthoringPiHooks } from "@/ai/authoring/agent/pi-hooks";

export type { AuthoringAgentFinishPayload, AuthoringAgentProtocolEvent };

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
  const runId = `${input.turnId ?? input.sessionId ?? "authoring"}-${Date.now().toString(36)}`;
  const startedAtMs = Date.now();
  let ledgerSeq = 0;

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
    return buildRuntimeSurfaceForCurrentState({
      capabilities: initialDecision,
      decideAction: decideWorkflowActionForCurrentState,
      applyStateChangingAction: (action) => {
        currentAuthoringWorkflowState = applyWorkflowTransition({
          state: currentAuthoringWorkflowState,
          action,
          baseVersion: input.baseVersion,
          contextStatus: toolRuntime.getContextStatusSnapshot(
            getActiveGoal(currentAuthoringWorkflowState),
          ),
        });
      },
    });
  };

  let currentSurface = buildWorkflowSurfaceForCurrentState();
  let currentActiveToolNames = new Set(currentSurface.activeTools);
  let forcedStepRetryUsed = false;

  const nextLedgerSeq = () => {
    ledgerSeq += 1;
    return ledgerSeq;
  };

  const writeLedger = async (event: AuthoringAgentLedgerEvent) => {
    await writeAuthoringLedgerEvent(input.dependencies, event);
  };

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
        reason: currentSurface.reason ?? null,
        profile: initialDecision.profile,
        scope: initialDecision.scope,
        scopeResolution: initialDecision.scopeResolution,
        actionKind: currentSurface.action?.kind ?? "inspect",
        activeTools: currentSurface.activeTools,
        toolChoice: currentSurface.toolChoice,
      },
    );
    await writeLedger(
      buildSurfaceLedgerEvent({
        seq: nextLedgerSeq(),
        runId,
        sessionId: input.sessionId,
        dashboardId: input.dashboardId,
        turnId: input.turnId,
        startedAtMs,
        surface: currentSurface,
        profile: initialDecision.profile,
        scope: initialDecision.scope,
        workflowState: currentAuthoringWorkflowState,
        contextFingerprint: currentContextBlock.fingerprint,
      }),
    );
  };

  const refreshRuntimeSurface = async (context?: AgentContext) => {
    currentSurface = buildWorkflowSurfaceForCurrentState();
    forcedStepRetryUsed = false;
    await applySurfaceToRuntime(context);
  };

  await applySurfaceToRuntime();

  const piHooks = buildAuthoringPiHooks({
    getCurrentSurface: () => currentSurface,
    getActiveToolNames: () => currentActiveToolNames,
    applyWorkflowToolTransition: ({ result, isError }) => {
      currentAuthoringWorkflowState = applyWorkflowTransition({
        state: currentAuthoringWorkflowState,
        action: currentSurface.action!,
        toolExecution: piToolResultToWorkflowExecution({ result, isError }),
        baseVersion: input.baseVersion,
        contextStatus: toolRuntime.getContextStatusSnapshot(
          getActiveGoal(currentAuthoringWorkflowState),
        ),
      });
    },
    refreshRuntimeSurface,
  });

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
    beforeToolCall: piHooks.beforeToolCall,
    afterToolCall: piHooks.afterToolCall,
    onPayload: async (payload) => {
      const providerPayload = summarizeProviderPayload({
        payload,
        provider: runtime.providerKind,
        modelId: runtime.modelId,
        api: runtime.model.api,
        thinkingLevel: runtime.thinkingLevel,
      });
      await writeLedger(
        buildProviderPayloadLedgerEvent({
          seq: nextLedgerSeq(),
          runId,
          sessionId: input.sessionId,
          dashboardId: input.dashboardId,
          turnId: input.turnId,
          startedAtMs,
          surface: currentSurface,
          profile: initialDecision.profile,
          scope: initialDecision.scope,
          workflowState: currentAuthoringWorkflowState,
          contextFingerprint: currentContextBlock.fingerprint,
          providerPayload,
        }),
      );
      await writeAuthoringTrace(
        input.dependencies!,
        "authoring-agent",
        "provider_payload",
        {
          sessionId: input.sessionId,
          provider: providerPayload.provider,
          modelId: providerPayload.modelId,
          api: providerPayload.api,
          thinkingLevel: providerPayload.thinkingLevel,
          inputCount: providerPayload.inputCount,
          messageCount: providerPayload.messageCount,
          toolCount: providerPayload.toolCount,
          storeFalse: providerPayload.storeFalse,
          observations: providerPayload.observations,
        },
      );
      return undefined;
    },
  });
  activeAgent = agent;

  agent.subscribe(async (event) => {
    await writeLedger(
      buildPiEventLedgerEvent({
        event,
        seq: nextLedgerSeq(),
        runId,
        sessionId: input.sessionId,
        dashboardId: input.dashboardId,
        turnId: input.turnId,
        startedAtMs,
        surface: currentSurface,
        profile: initialDecision.profile,
        scope: initialDecision.scope,
        workflowState: currentAuthoringWorkflowState,
        contextFingerprint: currentContextBlock.fingerprint,
      }),
    );
  });

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
