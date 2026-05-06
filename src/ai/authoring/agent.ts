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
  DeclareAuthoringGoalToolInput,
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
  shouldWritePiEventToLedger,
  type AuthoringAgentLedgerEvent,
} from "@/ai/authoring/agent/ledger";
import type {
  AuthoringAgentFinishPayload,
  AuthoringAgentProtocolEvent,
} from "@/ai/authoring/agent/protocol";
import {
  convertToLlm,
  sanitizeAgentMessages,
  transformAuthoringContext,
} from "@/ai/authoring/runtime/llm-boundary";
import { toPiAgentTools } from "@/ai/authoring/runtime/pi-tool-adapter";
import {
  buildApprovalToolSurface,
  buildAuthorToolSurface,
  buildChatToolSurface,
  buildInspectToolSurface,
  selectAuthoringToolSet,
  type RuntimeToolSurface,
} from "@/ai/authoring/agent/tool-surface";
import { buildAuthoringPiHooks } from "@/ai/authoring/agent/pi-hooks";
import { deriveAuthoringFacts } from "@/ai/authoring/runtime/derived-facts";

export type { AuthoringAgentFinishPayload, AuthoringAgentProtocolEvent };

function compactIdPart(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return compact || "goal";
}

function goalSummaryFromDeclaration(declaration: DeclareAuthoringGoalToolInput): string {
  if (declaration.kind === "set_data_mode") {
    return `set_${declaration.dataMode}`;
  }
  return (
    declaration.goal.summary ??
    declaration.goal.requestedChartLabel ??
    ("targetViewTitle" in declaration.goal
      ? declaration.goal.targetViewTitle
      : undefined) ??
    declaration.reason ??
    declaration.kind
  );
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
  let declaredGoalCounter = 0;
  let lastDeclaredGoalId: string | null = null;

  const transcript = sanitizeAgentMessages(input.agentMessages ?? []);
  const promptText = (input.promptText ?? "").trim();
  const initialConversation =
    deriveConversationSignalsFromTranscript({
      messages: transcript,
      promptText,
      hasApprovalRequest: Boolean(input.approvalEvent),
      approvalDecision: input.approvalEvent?.decision ?? null,
    });
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

  let activeAgent: Agent | null = null;
  const runtimeMessages = () => activeAgent?.state.messages ?? transcript;

  const getLatestDraftOutput = () =>
    findLatestDraftOutputFromTranscript(runtimeMessages());

  const getRuntimeApprovalContext = () => {
    const approvalEvent = input.approvalEvent;
    const latestDraft = getLatestDraftOutput();
    const pendingProposalId = latestDraft?.suggestion.id ?? null;
    const pendingProposalBaseVersion =
      typeof latestDraft?.base_version === "number"
        ? latestDraft.base_version
        : null;
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
          latestDraft?.draft_fingerprint,
      ),
      proposalId,
      baseVersion,
      pendingProposalId,
      pendingProposalBaseVersion,
      draftFingerprint: latestDraft?.draft_fingerprint ?? null,
    };
  };

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
    findLatestDraftOutput: getLatestDraftOutput,
    findDraftOutputBySuggestionId: (suggestionId) =>
      findDraftOutputBySuggestionIdFromTranscript(runtimeMessages(), suggestionId),
    getActiveGoalId: () => lastDeclaredGoalId,
    getBaseVersion: () => input.baseVersion,
    onDeclareAuthoringGoal: async (declaration) => {
      declaredGoalCounter += 1;
      const activeGoalId =
        declaration.kind === "set_data_mode"
          ? undefined
          : `goal_${compactIdPart(input.turnId ?? input.sessionId ?? "turn")}_${declaredGoalCounter}_${compactIdPart(goalSummaryFromDeclaration(declaration))}`;
      lastDeclaredGoalId = activeGoalId ?? lastDeclaredGoalId;
      return {
        accepted: true,
        declaredIntentKind: declaration.kind,
        ...(activeGoalId ? { activeGoalId } : {}),
        declaration,
        message:
          "Authoring goal recorded. Continue with the available authoring tools as needed.",
      };
    },
    getRuntimeApprovalContext,
  });

  const deriveFactsSnapshot = () =>
    deriveAuthoringFacts({
      messages: runtimeMessages(),
      draftStatus: toolRuntime.getDraftStatusSnapshot(),
      approvalEvent: input.approvalEvent,
    });

  const buildContextBlockSnapshot = () => {
    const facts = deriveFactsSnapshot();
    return buildAuthoringContextBlock({
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
      facts,
      scopeResolution: initialDecision.scopeResolution,
      proposalSummary: facts.pendingProposal
        ? {
            proposal_id: facts.pendingProposal.proposalId,
            summary: facts.pendingProposal.summary,
            operation_count: facts.pendingProposal.operationCount,
          }
        : null,
    });
  };

  const buildInitialSurface = (): RuntimeToolSurface => {
    if (input.approvalEvent?.decision === "approve") {
      return buildApprovalToolSurface({ scope: initialDecision.scope });
    }
    if (input.approvalEvent?.decision === "reject") {
      return buildChatToolSurface({
        scope: initialDecision.scope,
        reason: "chat_only",
      });
    }
    if (initialDecision.allowedTools.length === 0) {
      return buildChatToolSurface({
        scope: initialDecision.scope,
        reason: initialDecision.scopeResolution.requires_scope_clarification
          ? "scope_blocked"
          : "chat_only",
      });
    }
    if (initialDecision.profile === "explore") {
      return buildInspectToolSurface({
        scope: initialDecision.scope,
        profile: initialDecision.profile,
      });
    }
    if (
      initialDecision.profile === "author-dashboard" ||
      initialDecision.profile === "author-focused"
    ) {
      return buildAuthorToolSurface({
        scope: initialDecision.scope,
        allowedTools: initialDecision.allowedTools,
      });
    }
    return buildChatToolSurface({
      scope: initialDecision.scope,
      reason: "chat_only",
    });
  };

  let currentSurface = buildInitialSurface();
  let currentContextBlock = buildContextBlockSnapshot();
  let currentActiveToolNames = new Set(currentSurface.activeTools);
  let lastSurfaceLedgerKey: string | null = null;

  await writeAuthoringTrace(
    input.dependencies,
    "authoring-agent",
    "turn_start",
    {
      sessionId: input.sessionId,
      mode: currentSurface.mode,
      explicitIntent: input.intent ?? null,
      approvalEvent: input.approvalEvent ?? null,
    },
  );

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

  const applySurfaceToRuntime = async (context?: AgentContext) => {
    currentContextBlock = buildContextBlockSnapshot();
    currentActiveToolNames = new Set(currentSurface.activeTools);
    const facts = deriveFactsSnapshot();
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
        activeTools: currentSurface.activeTools,
        toolChoice: currentSurface.toolChoice,
      },
    );
    const surfaceLedgerKey = JSON.stringify({
      mode: currentSurface.mode,
      reason: currentSurface.reason ?? null,
      activeTools: currentSurface.activeTools,
      toolChoice: currentSurface.toolChoice,
      draftHasChanges: facts.draft?.hasDraft ?? false,
      draftCanCompose: facts.draft?.canCompose ?? false,
      blockers: facts.draft?.blockers ?? [],
      latestCheckStatus: facts.latestCheck?.status ?? null,
      approvalDecision: facts.approval?.decision ?? null,
    });
    if (surfaceLedgerKey !== lastSurfaceLedgerKey) {
      lastSurfaceLedgerKey = surfaceLedgerKey;
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
          facts,
          contextFingerprint: currentContextBlock.fingerprint,
        }),
      );
    }
  };

  const refreshRuntimeSurface = async (context?: AgentContext) => {
    await applySurfaceToRuntime(context);
  };

  await applySurfaceToRuntime();

  const piHooks = buildAuthoringPiHooks({
    getCurrentSurface: () => currentSurface,
    getActiveToolNames: () => currentActiveToolNames,
    isApprovalToolAllowed: () => getRuntimeApprovalContext().approved,
    onToolResult: ({ toolName, isError }) => {
      if (!isError && (toolName === "composePatch" || toolName === "applyPatch")) {
        currentSurface = buildChatToolSurface({
          scope: initialDecision.scope,
          reason: "chat_only",
        });
      }
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
          facts: deriveFactsSnapshot(),
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
    if (!shouldWritePiEventToLedger(event)) {
      return;
    }
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
        facts: deriveFactsSnapshot(),
        contextFingerprint: currentContextBlock.fingerprint,
      }),
    );
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
    get contextFingerprint() {
      return currentContextBlock.fingerprint;
    },
  };
}
