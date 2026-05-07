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
  findLatestDraftOutputFromTranscript,
  findDraftOutputBySuggestionIdFromTranscript,
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
} from "@/ai/authoring/agent/protocol";
import {
  convertToLlm,
  sanitizeAgentMessages,
  transformAuthoringContext,
} from "@/ai/authoring/runtime/llm-boundary";
import { toPiAgentTools } from "@/ai/authoring/runtime/pi-tool-adapter";
import {
  applyAuthoringDraftToolPolicy,
  buildApprovalToolSurface,
  buildAuthorToolSurface,
  buildChatToolSurface,
  buildInspectToolSurface,
  selectAuthoringToolSet,
  surfaceConfigDigest,
  type RuntimeToolSurface,
} from "@/ai/authoring/agent/tool-surface";
import { buildAuthoringPiHooks } from "@/ai/authoring/agent/pi-hooks";
import { deriveAuthoringFacts } from "@/ai/authoring/runtime/derived-facts";
import type { DeclareAuthoringGoalToolInput } from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringScopeCapabilities,
} from "@/ai/authoring/contracts/runtime";

function uniqueNonEmpty(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function compactIdPart(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return compact || "goal";
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
  wallClockTimeoutMs?: number;
  loadFailures?: { datasources?: boolean; skills?: boolean } | null;
  onFinish?: (payload: AuthoringAgentFinishPayload) => Promise<void> | void;
}

export class AuthoringAgentSession {
  private agent: Agent | null = null;
  private surface!: RuntimeToolSurface;
  private lastSurfaceDigest: string | null = null;
  private lastSurfaceLedgerKey: string | null = null;
  private stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }> = [];
  private forceChatOnlyForTurn = false;
  private initialMessages: AgentMessage[] = [];

  private dashboard: DashboardDocument;
  private scope: ReturnType<typeof computeAuthoringScope>;
  private toolRuntime: ReturnType<typeof buildAuthoringTools>;
  private ledgerSeq = 0;
  private declaredGoalCounter = 0;
  private lastDeclaredGoalId: string | null = null;
  private runId: string;
  private startedAtMs: number;
  private config: AuthoringAgentSessionConfig;

  constructor(config: AuthoringAgentSessionConfig) {
    this.config = config;
    if (!config.dependencies) {
      throw new Error("Authoring dependencies are required to create the agent session.");
    }
    this.dashboard = config.dashboard;
    this.runId = `${config.turnId ?? config.sessionId ?? "authoring"}-${Date.now().toString(36)}`;
    this.startedAtMs = Date.now();

    const runtime = resolveProviderModelConfig();
    const transcript = sanitizeAgentMessages(config.agentMessages ?? []);
    this.initialMessages = transcript;
    const promptText = (config.promptText ?? "").trim();
    const initialConversation = deriveConversationSignalsFromTranscript({
      messages: transcript,
      promptText,
      hasApprovalRequest: Boolean(config.approvalEvent),
      approvalDecision: config.approvalEvent?.decision ?? null,
    });
    const decision = computeAuthoringScope(
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
    this.scope = decision;

    this.toolRuntime = buildAuthoringTools({
      scope: decision.scope,
      dashboard: config.dashboard,
      dashboardId: config.dashboardId,
      datasources: config.datasources,
      skills: config.skills,
      checks: config.checks,
      initialWorkingDraft: config.initialWorkingDraft,
      dependencies: config.dependencies,
      initialLastRunCheckState: config.initialLastRunCheckState,
      findLatestDraftOutput: () => this.findLatestDraftOutput(),
      findDraftOutputBySuggestionId: (id) => this.findDraftOutputBySuggestionId(id),
      getActiveGoalId: () => this.lastDeclaredGoalId,
      getBaseVersion: () => config.baseVersion,
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
          message: "Authoring goal recorded. Continue with the available authoring tools as needed.",
        };
      },
      getRuntimeApprovalContext: () => this.getApprovalContext(),
    });

    this.surface = this.buildSurfaceFromScope(decision);
  }

  private get runtimeMessages(): AgentMessage[] {
    return this.agent?.state.messages ?? this.initialMessages;
  }

  private findLatestDraftOutput() {
    return findLatestDraftOutputFromTranscript(this.runtimeMessages);
  }

  private findDraftOutputBySuggestionId(suggestionId: string) {
    return findDraftOutputBySuggestionIdFromTranscript(this.runtimeMessages, suggestionId);
  }

  private getApprovalContext() {
    const approvalEvent = this.config.approvalEvent;
    const latestDraft = this.findLatestDraftOutput();
    const pendingProposalId = latestDraft?.suggestion.id ?? null;
    const pendingProposalBaseVersion =
      typeof latestDraft?.base_version === "number" ? latestDraft.base_version : null;
    const proposalId =
      approvalEvent?.decision === "approve" ? approvalEvent.proposalId : null;
    const baseVersion =
      approvalEvent?.decision === "approve" ? approvalEvent.baseVersion : null;
    return {
      approved: Boolean(
        approvalEvent?.decision === "approve" &&
          proposalId && pendingProposalId &&
          proposalId === pendingProposalId &&
          typeof baseVersion === "number" && typeof pendingProposalBaseVersion === "number" &&
          baseVersion === pendingProposalBaseVersion &&
          latestDraft?.draft_fingerprint,
      ),
      proposalId, baseVersion, pendingProposalId, pendingProposalBaseVersion,
      draftFingerprint: latestDraft?.draft_fingerprint ?? null,
    };
  }

  private buildSurfaceFromScope(decision: AuthoringScopeCapabilities): RuntimeToolSurface {
    if (this.forceChatOnlyForTurn) {
      return buildChatToolSurface({ scope: decision.scope, reason: "chat_only" });
    }
    if (this.config.approvalEvent?.decision === "approve") {
      const approvalContext = this.getApprovalContext();
      if (approvalContext.approved) {
        return buildApprovalToolSurface({ scope: decision.scope });
      }
      return buildChatToolSurface({
        scope: decision.scope,
        reason: "approval_mismatch",
      });
    }
    if (this.config.approvalEvent?.decision === "reject") {
      return buildChatToolSurface({ scope: decision.scope, reason: "chat_only" });
    }
    if (decision.allowedTools.length === 0) {
      return buildChatToolSurface({
        scope: decision.scope,
        reason: decision.scopeResolution.requires_scope_clarification ? "scope_blocked" : "chat_only",
      });
    }
    if (decision.profile === "explore") {
      return buildInspectToolSurface({
        scope: decision.scope,
        profile: decision.profile,
        allowedTools: decision.allowedTools,
      });
    }
    if (decision.profile === "author-dashboard" || decision.profile === "author-focused") {
      const facts = this.deriveFactsSnapshot();
      const allowedTools = applyAuthoringDraftToolPolicy({
        allowedTools: decision.allowedTools,
        draft: facts.draft,
      });
      return buildAuthorToolSurface({ scope: decision.scope, allowedTools });
    }
    return buildChatToolSurface({ scope: decision.scope, reason: "chat_only" });
  }

  private deriveFactsSnapshot() {
    return deriveAuthoringFacts({
      messages: this.runtimeMessages,
      draftStatus: this.toolRuntime.getDraftStatusSnapshot(),
      approvalEvent: this.config.approvalEvent,
    });
  }

  private lastContextFingerprint: string = "";

  private buildContextBlockSnapshot() {
    const facts = this.deriveFactsSnapshot();
    const decision = this.scope;
    const block = buildAuthoringContextBlock({
      variant: decision.contextBlockVariant,
      dashboard: this.dashboard,
      dashboardId: this.config.dashboardId,
      focusedViewId: decision.scope.kind === "focused" ? decision.scope.viewId : this.config.focusedViewId,
      datasources: this.config.datasources,
      checks: this.config.checks,
      latestUserText: (this.config.promptText ?? "").trim() || "",
      intent: this.config.intent ?? null,
      draftStatus: this.toolRuntime.getDraftStatusSnapshot(),
      facts,
      scopeResolution: decision.scopeResolution,
      proposalSummary: facts.pendingProposal ? {
        proposal_id: facts.pendingProposal.proposalId,
        summary: facts.pendingProposal.summary,
        operation_count: facts.pendingProposal.operationCount,
      } : null,
    });
    this.lastContextFingerprint = block.fingerprint;
    return block;
  }

  private buildSystemPromptForSurface(surface: RuntimeToolSurface) {
    const toolPromptMetadata = this.buildToolPromptMetadata(surface);
    return buildAuthoringSystemPrompt({
      sections: surface.promptSections,
      scope: this.scope.scope,
      skills: this.config.skills,
      relevantSkillIds: this.scope.relevantSkillIds,
      draftStatus: this.toolRuntime.getDraftStatusSnapshot(),
      loadFailures: this.config.loadFailures,
      toolPromptSnippets: toolPromptMetadata.snippets,
      toolPromptGuidelines: toolPromptMetadata.guidelines,
    });
  }

  private buildToolPromptMetadata(surface: RuntimeToolSurface) {
    const selectedTools = selectAuthoringToolSet({
      tools: this.toolRuntime.tools,
      activeTools: surface.activeTools,
    });
    return {
      snippets: uniqueNonEmpty(
        Object.values(selectedTools).map((definition) => definition.promptSnippet),
      ),
      guidelines: uniqueNonEmpty(
        Object.values(selectedTools).flatMap((definition) =>
          definition.promptGuidelines ?? [],
        ),
      ),
    };
  }

  private buildPiToolsForSurface(surface: RuntimeToolSurface) {
    return toPiAgentTools(
      selectAuthoringToolSet({
        tools: this.toolRuntime.tools,
        activeTools: surface.activeTools,
      }),
    );
  }

  private nextLedgerSeq() {
    this.ledgerSeq += 1;
    return this.ledgerSeq;
  }

  private async writeLedger(event: AuthoringAgentLedgerEvent) {
    await writeAuthoringLedgerEvent(this.config.dependencies, event);
  }

  private async writeTrace(scope: string, event: string, payload?: unknown) {
    await writeAuthoringTrace(this.config.dependencies, scope, event, payload);
  }

  private async applySurfaceToRuntime(context?: AgentContext) {
    // Recompute scope with up-to-date tool failure history so filterToolFailures
    // can drop tools that have failed TOOL_FAILURE_THRESHOLD consecutive times.
    const conversation = deriveConversationSignalsFromTranscript({
      messages: sanitizeAgentMessages(this.runtimeMessages),
      promptText: this.config.promptText ?? "",
      hasApprovalRequest: Boolean(this.config.approvalEvent),
      approvalDecision: this.config.approvalEvent?.decision ?? null,
    });
    const decision = computeAuthoringScope(
      buildScopeInput({
        dashboard: this.config.dashboard,
        dashboardId: this.config.dashboardId,
        datasources: this.config.datasources,
        conversation,
        focusedViewId: this.config.focusedViewId,
        checks: this.config.checks,
        skills: this.config.skills,
        intent: this.config.intent,
        stepHistoryInTurn: this.stepHistoryInTurn,
        lockedProfile: this.scope.profile,
      }),
    );
    this.scope = decision;
    this.surface = this.buildSurfaceFromScope(decision);

    const facts = this.deriveFactsSnapshot();
    const piTools = this.buildPiToolsForSurface(this.surface);
    const systemPrompt = this.buildSystemPromptForSurface(this.surface);
    if (this.agent) {
      this.agent.state.tools = piTools;
      this.agent.state.systemPrompt = systemPrompt;
    }
    if (context) {
      context.tools = piTools;
      context.systemPrompt = systemPrompt;
    }
    await this.writeTrace("authoring-agent", "prepare-step", {
      sessionId: this.config.sessionId,
      mode: this.surface.mode,
      reason: this.surface.reason ?? null,
      profile: this.scope.profile,
      scope: this.scope.scope,
      scopeResolution: this.scope.scopeResolution,
      activeTools: this.surface.activeTools,
      toolChoice: this.surface.toolChoice,
    });
    const surfaceLedgerKey = JSON.stringify({
      mode: this.surface.mode,
      reason: this.surface.reason ?? null,
      activeTools: this.surface.activeTools,
      toolChoice: this.surface.toolChoice,
      draftHasChanges: facts.draft?.hasDraft ?? false,
      draftCanCompose: facts.draft?.canCompose ?? false,
      blockers: facts.draft?.blockers ?? [],
      latestCheckStatus: facts.latestCheck?.status ?? null,
      approvalDecision: facts.approval?.decision ?? null,
    });
    if (surfaceLedgerKey !== this.lastSurfaceLedgerKey) {
      this.lastSurfaceLedgerKey = surfaceLedgerKey;
      await this.writeLedger(
        buildSurfaceLedgerEvent({
          seq: this.nextLedgerSeq(),
          runId: this.runId,
          sessionId: this.config.sessionId,
          dashboardId: this.config.dashboardId,
          turnId: this.config.turnId,
          startedAtMs: this.startedAtMs,
          surface: this.surface,
          profile: this.scope.profile,
          scope: this.scope.scope,
          facts,
          contextFingerprint: this.lastContextFingerprint,
        }),
      );
    }
    const newDigest = surfaceConfigDigest(this.surface);
    this.lastSurfaceDigest = newDigest;
  }

  async startTurn() {
    this.forceChatOnlyForTurn = false;
    this.stepHistoryInTurn = [];

    const runtime = resolveProviderModelConfig();
    const config = this.config;

    await this.writeTrace("authoring-agent", "turn_start", {
      sessionId: config.sessionId,
      mode: this.surface.mode,
      explicitIntent: config.intent ?? null,
      approvalEvent: config.approvalEvent ?? null,
    });

    await this.applySurfaceToRuntime();

    const piHooks = buildAuthoringPiHooks({
      getCurrentSurface: () => this.surface,
      getActiveToolNames: () => new Set(this.surface.activeTools),
      isApprovalToolAllowed: () => this.getApprovalContext().approved,
      onToolResult: ({ toolName, isError }) => {
        this.stepHistoryInTurn.push({
          toolName,
          outcome: isError ? "error" : "ok",
        });
        if (!isError && (toolName === "composePatch" || toolName === "applyPatch")) {
          this.forceChatOnlyForTurn = true;
          this.surface = this.buildSurfaceFromScope(this.scope);
        }
        this.lastSurfaceDigest = null;
      },
      refreshRuntimeSurface: (context) => this.applySurfaceToRuntime(context),
      getLastSurfaceDigest: () => this.lastSurfaceDigest,
      setLastSurfaceDigest: (d) => { this.lastSurfaceDigest = d; },
    });

    const agent = new Agent({
      initialState: {
        model: runtime.model,
        thinkingLevel: runtime.thinkingLevel,
        systemPrompt: this.buildSystemPromptForSurface(this.surface),
        tools: this.buildPiToolsForSurface(this.surface),
        messages: sanitizeAgentMessages(config.agentMessages ?? []),
      },
      sessionId: createAuthoringProviderSessionId(config.sessionId),
      getApiKey: runtime.getApiKey,
      thinkingBudgets: { minimal: 1024, low: 2048, medium: 4096, high: 8192 },
      transport: "sse",
      toolExecution: "sequential",
      transformContext: async (messages, signal) => {
        if (signal?.aborted) return messages;
        return transformAuthoringContext({
          messages,
          contextMarkdown: this.buildContextBlockSnapshot().markdown,
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
        await this.writeLedger(
          buildProviderPayloadLedgerEvent({
            seq: this.nextLedgerSeq(),
            runId: this.runId,
            sessionId: config.sessionId,
            dashboardId: config.dashboardId,
            turnId: config.turnId,
            startedAtMs: this.startedAtMs,
            surface: this.surface,
            profile: this.scope.profile,
            scope: this.scope.scope,
            facts: this.deriveFactsSnapshot(),
            contextFingerprint: this.lastContextFingerprint,
            providerPayload,
          }),
        );
        await this.writeTrace("authoring-agent", "provider_payload", {
          sessionId: config.sessionId,
          provider: providerPayload.provider,
          modelId: providerPayload.modelId,
          api: providerPayload.api,
          thinkingLevel: providerPayload.thinkingLevel,
          inputCount: providerPayload.inputCount,
          messageCount: providerPayload.messageCount,
          toolCount: providerPayload.toolCount,
          storeFalse: providerPayload.storeFalse,
          observations: providerPayload.observations,
        });
        return undefined;
      },
    });
    this.agent = agent;

    agent.subscribe(async (event) => {
      if (!shouldWritePiEventToLedger(event)) return;
      await this.writeLedger(
        buildPiEventLedgerEvent({
          event,
          seq: this.nextLedgerSeq(),
          runId: this.runId,
          sessionId: config.sessionId,
          dashboardId: config.dashboardId,
          turnId: config.turnId,
          startedAtMs: this.startedAtMs,
          surface: this.surface,
          profile: this.scope.profile,
          scope: this.scope.scope,
          facts: this.deriveFactsSnapshot(),
          contextFingerprint: this.lastContextFingerprint,
        }),
      );
    });

    const stream = createAuthoringAgentEventStream({
      agent,
      promptText: config.promptText ?? "",
      sessionId: config.sessionId,
      abortSignal: config.abortSignal,
      wallClockTimeoutMs: config.wallClockTimeoutMs ?? resolveAuthoringWallClockTimeout(runtime),
      dependencies: config.dependencies!,
      onFinish: config.onFinish,
    });

    const session = this;
    return {
      stream,
      getAgentMessagesSnapshot: () => agent.state.messages,
      getDraftSnapshot: this.toolRuntime.getDraftSnapshot,
      getLastRunCheckStateSnapshot: this.toolRuntime.getLastRunCheckStateSnapshot,
      get contextFingerprint() {
        return session.lastContextFingerprint || null;
      },
    };
  }
}
