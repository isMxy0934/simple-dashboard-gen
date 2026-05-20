import {
  Agent,
  type AgentContext,
  type AgentMessage,
} from "@mariozechner/pi-agent-core";
import type { DashboardDocument } from "@/contracts";
import type { PiModelRuntime } from "@/ai/providers";
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
import type { AuthoringScopeCapabilities } from "@/ai/authoring/contracts/runtime";
import { buildAuthoringTools } from "@/ai/authoring/tools/factory";
import {
  convertToLlm,
  sanitizeAgentMessages,
  transformAuthoringContext,
} from "@/ai/authoring/runtime/llm-boundary";
import {
  findDraftOutputBySuggestionIdFromTranscript,
  findLatestDraftOutputFromTranscript,
} from "@/ai/authoring/runtime/transcript-inspection";
import { buildAuthoringPiHooks } from "@/ai/authoring/agent/pi-hooks";
import { createAuthoringAgentEventStream } from "@/ai/authoring/agent/event-stream";
import {
  createAuthoringProviderSessionId,
  resolveAuthoringWallClockTimeout,
} from "@/ai/authoring/agent/provider-session";
import { summarizeProviderPayload } from "@/ai/authoring/agent/provider-observability";
import {
  buildPiEventLedgerEvent,
  buildProviderPayloadLedgerEvent,
  shouldWritePiEventToLedger,
} from "@/ai/authoring/agent/ledger";
import type { AuthoringAgentFinishPayload } from "@/ai/authoring/agent/protocol";
import { AuthoringLedgerSink } from "@/ai/authoring/agent/ledger-sink";
import {
  AuthoringScopeManager,
  type AuthoringScopeTurnConfig,
} from "@/ai/authoring/agent/scope-manager";
import { computeAuthoringScope } from "@/ai/authoring/runtime/capability-scope";
import { buildScopeInput } from "@/ai/authoring/agent/scope-input";
import { deriveConversationSignalsFromTranscript } from "@/ai/authoring/runtime/transcript-inspection";
import type { DeclareAuthoringGoalToolInput } from "@/ai/authoring/contracts/tool-io";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compactIdPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "goal"
  );
}

function goalSummaryFromDeclaration(declaration: DeclareAuthoringGoalToolInput): string {
  if (declaration.kind === "set_data_mode") return `set_${declaration.dataMode}`;
  return (
    declaration.goal.summary ??
    declaration.goal.requestedChartLabel ??
    ("targetViewTitle" in declaration.goal ? declaration.goal.targetViewTitle : undefined) ??
    declaration.reason ??
    declaration.kind
  );
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Full configuration used on first construction / cold start. */
export interface AuthoringAgentSessionConfig {
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
  rejectedProposalIds?: readonly string[] | null;
  currentDocumentHash?: string | null;
  wallClockTimeoutMs?: number;
  modelRuntime?: PiModelRuntime;
  loadFailures?: { datasources?: boolean; skills?: boolean } | null;
  onFinish?: (payload: AuthoringAgentFinishPayload) => Promise<void> | void;
}

/** Subset of config that changes every request when the session is reused from the pool. */
export type AuthoringAgentTurnConfig = Pick<
  AuthoringAgentSessionConfig,
  | "dashboard"
  | "dashboardId"
  | "focusedViewId"
  | "datasources"
  | "skills"
  | "checks"
  | "promptText"
  | "intent"
  | "approvalEvent"
  | "currentDocumentHash"
  | "baseVersion"
  | "dependencies"
  | "modelRuntime"
  | "rejectedProposalIds"
  | "loadFailures"
  | "turnId"
  | "abortSignal"
  | "wallClockTimeoutMs"
  | "onFinish"
>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * One authoring agent session, tied to a single `sessionId`.
 *
 * The underlying pi `Agent` is created lazily on the first `startTurn()` call
 * and kept alive across subsequent calls (pool reuse pattern).  Per-turn
 * configuration is updated via `setTurnConfig()` before each `startTurn()`.
 *
 * Thread-safety note: `startTurn()` must not be called concurrently on the same
 * instance.  The active-streams lease in `chat-service.ts` prevents that.
 */
export class AuthoringAgentSession {
  /** The pi Agent – null until the first startTurn(). */
  private _agent: Agent | null = null;

  private config: AuthoringAgentSessionConfig;
  private readonly initialMessages: AgentMessage[];

  private readonly toolRuntime: ReturnType<typeof buildAuthoringTools>;
  private readonly ledgerSink: AuthoringLedgerSink;
  private readonly scopeManager: AuthoringScopeManager;

  private declaredGoalCounter = 0;
  private lastDeclaredGoalId: string | null = null;

  /** Exposed for the pool and steer route. */
  get piAgent(): Agent | null {
    return this._agent;
  }

  constructor(config: AuthoringAgentSessionConfig) {
    if (!config.dependencies) {
      throw new Error("Authoring dependencies are required to create the agent session.");
    }
    this.config = config;
    this.initialMessages = sanitizeAgentMessages(config.agentMessages ?? []);

    const runId = `${config.turnId ?? config.sessionId ?? "authoring"}-${Date.now().toString(36)}`;

    this.ledgerSink = new AuthoringLedgerSink(config.dependencies, {
      runId,
      startedAtMs: Date.now(),
      sessionId: config.sessionId,
      dashboardId: config.dashboardId,
      turnId: config.turnId,
    });

    // Compute initial scope to seed buildAuthoringTools (used for draft init etc.)
    const initialConversation = deriveConversationSignalsFromTranscript({
      messages: this.initialMessages,
      promptText: (config.promptText ?? "").trim(),
      hasApprovalRequest: Boolean(config.approvalEvent),
      approvalDecision: config.approvalEvent?.decision ?? null,
      currentDocumentHash: config.currentDocumentHash ?? null,
    });
    const initialScope = computeAuthoringScope(
      buildScopeInput({
        dashboard: config.dashboard,
        dashboardId: config.dashboardId,
        datasources: config.datasources,
        conversation: initialConversation,
        focusedViewId: config.focusedViewId,
        checks: config.checks,
        skills: config.skills,
        intent: config.intent,
      }),
    );

    this.toolRuntime = buildAuthoringTools({
      scope: initialScope.scope,
      dashboard: config.dashboard,
      dashboardId: config.dashboardId,
      datasources: config.datasources,
      skills: config.skills,
      checks: config.checks,
      initialWorkingDraft: config.initialWorkingDraft,
      dependencies: config.dependencies,
      initialLastRunCheckState: config.initialLastRunCheckState,
      findLatestDraftOutput: () =>
        findLatestDraftOutputFromTranscript(this.runtimeMessages),
      findDraftOutputBySuggestionId: (id) =>
        findDraftOutputBySuggestionIdFromTranscript(this.runtimeMessages, id),
      getActiveGoalId: () => this.lastDeclaredGoalId,
      getBaseVersion: () => this.config.baseVersion,
      onDeclareAuthoringGoal: async (declaration) => {
        this.declaredGoalCounter += 1;
        const activeGoalId =
          declaration.kind === "set_data_mode"
            ? undefined
            : `goal_${compactIdPart(config.turnId ?? config.sessionId ?? "turn")}_${this.declaredGoalCounter}_${compactIdPart(goalSummaryFromDeclaration(declaration))}`;
        this.lastDeclaredGoalId = activeGoalId ?? this.lastDeclaredGoalId;
        return {
          accepted: true,
          declaredIntentKind: declaration.kind,
          ...(activeGoalId ? { activeGoalId } : {}),
          declaration,
          message:
            "Authoring goal recorded. Continue with the available authoring tools as needed.",
        };
      },
      getRuntimeApprovalContext: () => this.getApprovalContext(),
    });
    this.applyTurnRuntimeSideEffects(config);

    const initialScopeTurnConfig = this.buildScopeTurnConfig();
    this.scopeManager = new AuthoringScopeManager(initialScopeTurnConfig, {
      ledgerSink: this.ledgerSink,
      getToolSet: () => this.toolRuntime.getTools(),
      getDraftStatusSnapshot: () => this.toolRuntime.getDraftStatusSnapshot(),
      getApprovalContext: () => this.getApprovalContext(),
      getRuntimeMessages: () => this.runtimeMessages,
      onScopeResolved: (scope) => this.syncToolRuntimeContextToScope(scope),
      baseThinkingLevel: () => this.config.modelRuntime?.thinkingLevel ?? "medium",
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Update per-turn configuration when this session is reused from the pool.
   * Must be called before `startTurn()` on subsequent turns.
   */
  setTurnConfig(partial: AuthoringAgentTurnConfig): void {
    this.config = { ...this.config, ...partial };
    this.ledgerSink.setDependencies(this.config.dependencies);
    this.applyTurnRuntimeSideEffects(this.config);
    this.scopeManager.setTurnConfig(this.buildScopeTurnConfig());
    this.declaredGoalCounter = 0;
    this.lastDeclaredGoalId = null;
    // Refresh non-scope runtime state immediately; focusedViewId is derived
    // from the resolved scope in applySurfaceToAgent.
    this.toolRuntime.updateRuntimeContext({
      dashboard: this.config.dashboard,
      checks: this.config.checks,
      datasources: this.config.datasources,
      skills: this.config.skills,
      focusedViewId: null,
    });
  }

  /**
   * Start a new agent turn.  If the Agent has not been created yet (cold start)
   * it is created here using `this.initialMessages`.  Subsequent calls reuse
   * the existing Agent, updating only its mutable `beforeToolCall`,
   * `afterToolCall`, `tools`, and `systemPrompt`.
   *
   * Returns the SSE stream and snapshot accessors for this turn.
   */
  async startTurn() {
    this.scopeManager.resetForTurn();

    const config = this.config;
    const runtime = config.modelRuntime;
    if (!runtime) {
      throw new Error("Pi model runtime is required to start an authoring agent turn.");
    }

    // Refresh run context for this turn so all ledger writes use correct ids.
    const runId = `${config.turnId ?? config.sessionId ?? "authoring"}-${Date.now().toString(36)}`;
    this.ledgerSink.setRunContext({
      runId,
      startedAtMs: Date.now(),
      sessionId: config.sessionId,
      dashboardId: config.dashboardId,
      turnId: config.turnId,
    });

    await this.ledgerSink.trace("authoring-agent", "turn_start", {
      sessionId: config.sessionId,
      mode: this.scopeManager.getCurrentSurface().mode,
      explicitIntent: config.intent ?? null,
      approvalEvent: config.approvalEvent ?? null,
    });

    if (this._agent) {
      this._agent.state.model = runtime.model;
      this._agent.streamFn = runtime.streamFn;
    }

    await this.scopeManager.applySurfaceToAgent(this._agent);
    const turnThinkingLevel = this.scopeManager.getCurrentThinkingLevel();

    const piHooks = buildAuthoringPiHooks({
      getCurrentSurface: () => this.scopeManager.getCurrentSurface(),
      getActiveToolNames: () => this.scopeManager.getActiveToolNames(),
      getToolDefinition: (toolName) => this.toolRuntime.getTools()[toolName],
      onToolResult: ({ toolName, isError }) => {
        this.scopeManager.onToolResult(toolName, isError);
      },
      refreshRuntimeSurface: (context?: AgentContext) =>
        this.scopeManager.applySurfaceToAgent(this._agent, context),
      getLastSurfaceDigest: () => this.scopeManager.getLastSurfaceDigest(),
      setLastSurfaceDigest: (d) => this.scopeManager.setLastSurfaceDigest(d),
    });

    if (!this._agent) {
      // -----------------------------------------------------------------------
      // Cold start: create the Agent for the first time.
      // The onPayload callback reads from `this.ledgerSink` (always current).
      // -----------------------------------------------------------------------
      const agent = new Agent({
        initialState: {
          model: runtime.model,
          thinkingLevel: turnThinkingLevel,
          systemPrompt: this.scopeManager.buildSystemPrompt(),
          tools: this.scopeManager.buildPiTools(),
          messages: this.initialMessages,
        },
        sessionId: createAuthoringProviderSessionId(config.sessionId),
        streamFn: runtime.streamFn,
        thinkingBudgets: { minimal: 1024, low: 2048, medium: 4096, high: 8192 },
        transport: "sse",
        toolExecution: "sequential",
        transformContext: async (messages, signal) => {
          if (signal?.aborted) return messages;
          return transformAuthoringContext({
            messages,
            contextMarkdown: this.scopeManager.buildContextBlock().markdown,
          });
        },
        convertToLlm: async (messages) => convertToLlm(messages),
        onPayload: async (payload) => {
          // Reads from this.ledgerSink which is updated per turn – no stale captures.
          const ctx = this.ledgerSink.getRunContext();
          const payloadRuntime = this.config.modelRuntime ?? runtime;
          const providerPayload = summarizeProviderPayload({
            payload,
            provider: payloadRuntime.provider,
            modelId: payloadRuntime.modelId,
            api: payloadRuntime.model.api,
            thinkingLevel:
              this._agent?.state.thinkingLevel ??
              this.scopeManager.getCurrentThinkingLevel(),
          });
          const currentScope = this.scopeManager.getCurrentScope();
          await this.ledgerSink.write(
            buildProviderPayloadLedgerEvent({
              seq: this.ledgerSink.nextSeq(),
              runId: ctx.runId,
              sessionId: ctx.sessionId,
              dashboardId: ctx.dashboardId,
              turnId: ctx.turnId,
              startedAtMs: ctx.startedAtMs,
              surface: this.scopeManager.getCurrentSurface(),
              profile: currentScope.profile,
              scope: currentScope.scope,
              facts: this.scopeManager.deriveFactsSnapshot(),
              contextFingerprint: this.scopeManager.lastContextFingerprint,
              providerPayload,
            }),
          );
          await this.ledgerSink.trace("authoring-agent", "provider_payload", {
            sessionId: ctx.sessionId,
            provider: providerPayload.provider,
            modelId: providerPayload.modelId,
            api: providerPayload.api,
            thinkingLevel: providerPayload.thinkingLevel,
            thinkingParam: providerPayload.thinkingParam,
            enableThinking: providerPayload.enableThinking,
            reasoningEffort: providerPayload.reasoningEffort,
            inputCount: providerPayload.inputCount,
            messageCount: providerPayload.messageCount,
            toolCount: providerPayload.toolCount,
            storeFalse: providerPayload.storeFalse,
            observations: providerPayload.observations,
          });
          return undefined;
        },
      });
      this._agent = agent;
    }

    // Per-turn: update the mutable hook slots on the (possibly pre-existing) Agent.
    this._agent.beforeToolCall = piHooks.beforeToolCall;
    this._agent.afterToolCall = piHooks.afterToolCall;

    // Per-turn: subscribe for pi event ledger, self-unsubscribes on agent_end.
    // Snapshot turn context and scope at subscription time – avoids stale captures
    // when the Agent is reused across multiple turns.
    const turnCtx = { ...this.ledgerSink.getRunContext() };
    const turnScope = this.scopeManager.getCurrentScope();
    const unsubscribeLedger = this._agent.subscribe(async (event) => {
      if (!shouldWritePiEventToLedger(event)) {
        if (event.type === "agent_end") unsubscribeLedger();
        return;
      }
      await this.ledgerSink.write(
        buildPiEventLedgerEvent({
          event,
          seq: this.ledgerSink.nextSeq(),
          runId: turnCtx.runId,
          sessionId: turnCtx.sessionId,
          dashboardId: turnCtx.dashboardId,
          turnId: turnCtx.turnId,
          startedAtMs: turnCtx.startedAtMs,
          surface: this.scopeManager.getCurrentSurface(),
          profile: turnScope.profile,
          scope: turnScope.scope,
          facts: this.scopeManager.deriveFactsSnapshot(),
          contextFingerprint: this.scopeManager.lastContextFingerprint,
        }),
      );
      if (event.type === "agent_end") {
        unsubscribeLedger();
      }
    });

    const stream = createAuthoringAgentEventStream({
      agent: this._agent,
      promptText: config.promptText ?? "",
      sessionId: config.sessionId,
      abortSignal: config.abortSignal,
      wallClockTimeoutMs:
        config.wallClockTimeoutMs ??
        resolveAuthoringWallClockTimeout({
          thinkingLevel: this._agent.state.thinkingLevel ?? turnThinkingLevel,
        }),
      dependencies: config.dependencies!,
      onFinish: config.onFinish,
    });

    const self = this;
    return {
      stream,
      getAgentMessagesSnapshot: () => self._agent!.state.messages,
      getDraftSnapshot: this.toolRuntime.getDraftSnapshot,
      getLastRunCheckStateSnapshot: this.toolRuntime.getLastRunCheckStateSnapshot,
      get contextFingerprint() {
        return self.scopeManager.lastContextFingerprint || null;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Test-only accessors used by unit tests that introspect private state.
  // ---------------------------------------------------------------------------

  /** @internal */
  get surface() { return this.scopeManager.getCurrentSurface(); }

  /**
   * Injects turn-local state for unit tests. Delegates to the scope manager.
   * Not intended for production use.
   */
  setTurnStateForTest(state: {
    stepHistoryInTurn?: Array<{ toolName: string; outcome: "ok" | "error" }>;
    forceChatOnlyForTurn?: boolean;
  }): void {
    this.scopeManager.setTurnStateForTest(state);
  }

  /** @internal */
  get lastContextFingerprint(): string { return this.scopeManager.lastContextFingerprint; }

  /** @internal */
  applySurfaceToRuntime(context?: AgentContext): Promise<void> {
    return this.scopeManager.applySurfaceToAgent(this._agent, context);
  }

  /** @internal */
  buildContextBlockSnapshot() { return this.scopeManager.buildContextBlock(); }

  /** @internal */
  buildSystemPromptForSurface(surface: Parameters<typeof this.scopeManager.buildSystemPrompt>[0]) {
    return this.scopeManager.buildSystemPrompt(surface);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private get runtimeMessages(): AgentMessage[] {
    return this._agent?.state.messages ?? this.initialMessages;
  }

  private getApprovalContext() {
    const approvalEvent = this.config.approvalEvent;
    const rMessages = this.runtimeMessages;
    const requestedDraft = approvalEvent?.proposalId
      ? findDraftOutputBySuggestionIdFromTranscript(rMessages, approvalEvent.proposalId)
      : null;
    const latestDraft = findLatestDraftOutputFromTranscript(rMessages);
    const pendingDraft = requestedDraft ?? latestDraft;
    const pendingProposalId = pendingDraft?.suggestion.id ?? null;
    const pendingProposalBaseVersion =
      typeof pendingDraft?.base_version === "number" ? pendingDraft.base_version : null;
    const proposalId =
      approvalEvent?.decision === "approve" ? approvalEvent.proposalId : null;
    const baseVersion =
      approvalEvent?.decision === "approve" ? approvalEvent.baseVersion : null;
    const currentDocumentHash = this.config.currentDocumentHash?.trim() || null;
    const pendingBaseDocumentFingerprint =
      pendingDraft?.base_document_fingerprint?.trim() || null;
    const draftFingerprint = pendingDraft?.draft_fingerprint?.trim() ?? null;
    return {
      approved: Boolean(
        approvalEvent?.decision === "approve" &&
          proposalId &&
          pendingProposalId &&
          proposalId === pendingProposalId &&
          typeof baseVersion === "number" &&
          typeof pendingProposalBaseVersion === "number" &&
          baseVersion === pendingProposalBaseVersion &&
          draftFingerprint &&
          currentDocumentHash &&
          pendingBaseDocumentFingerprint === currentDocumentHash,
      ),
      proposalId,
      baseVersion,
      pendingProposalId,
      pendingProposalBaseVersion,
      currentDocumentHash,
      pendingBaseDocumentFingerprint,
      draftFingerprint,
      pendingDraft,
    };
  }

  private buildScopeTurnConfig(): AuthoringScopeTurnConfig {
    return {
      dashboard: this.config.dashboard,
      dashboardId: this.config.dashboardId,
      focusedViewId: this.config.focusedViewId,
      datasources: this.config.datasources,
      skills: this.config.skills,
      checks: this.config.checks,
      promptText: this.config.promptText,
      intent: this.config.intent,
      approvalEvent: this.config.approvalEvent,
      currentDocumentHash: this.config.currentDocumentHash,
      loadFailures: this.config.loadFailures,
      rejectedProposalIds: this.config.rejectedProposalIds,
    };
  }

  private applyTurnRuntimeSideEffects(config: AuthoringAgentSessionConfig): void {
    if (config.approvalEvent?.decision === "reject") {
      this.toolRuntime.discardWorkingDraft();
    }
  }

  private syncToolRuntimeContextToScope(scope: AuthoringScopeCapabilities): void {
    this.toolRuntime.updateRuntimeContext({
      dashboard: this.config.dashboard,
      checks: this.config.checks,
      datasources: this.config.datasources,
      skills: this.config.skills,
      focusedViewId: scope.scope.kind === "focused" ? scope.scope.viewId : null,
    });
  }
}
