import type { AgentContext, AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringApprovalEvent,
  AuthoringIntent,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  DraftStatusToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringCapabilityProfile,
  AuthoringScopeCapabilities,
} from "@/ai/authoring/contracts/runtime";
import { computeAuthoringScope } from "@/ai/authoring/runtime/capability-scope";
import { deriveConversationSignalsFromTranscript } from "@/ai/authoring/runtime/transcript-inspection";
import { deriveAuthoringFacts } from "@/ai/authoring/runtime/derived-facts";
import { sanitizeAgentMessages } from "@/ai/authoring/runtime/llm-boundary";
import { buildAuthoringContextBlock } from "@/ai/authoring/messages/context-block";
import { buildAuthoringSystemPrompt } from "@/ai/authoring/messages/system-prompt";
import { formatAuthoringToolContract } from "@/ai/authoring/runtime/tool-error-normalizer";
import {
  resolveRuntimeToolSurface,
  selectAuthoringToolSet,
  surfaceConfigDigest,
  type RuntimeToolSurface,
} from "@/ai/authoring/agent/tool-surface";
import { toPiAgentTools } from "@/ai/authoring/runtime/pi-tool-adapter";
import { buildScopeInput } from "@/ai/authoring/agent/scope-input";
import {
  buildSurfaceLedgerEvent,
  type AuthoringAgentLedgerEvent,
} from "@/ai/authoring/agent/ledger";
import type { AuthoringLedgerSink } from "@/ai/authoring/agent/ledger-sink";
import type { AuthoringToolDefinition } from "@/ai/authoring/tools/definition";

const INSPECT_READ_TOOL_REPEAT_LIMIT = 3;
const INSPECT_READ_TOOL_TOTAL_LIMIT = 10;
const AUTHOR_TOOL_STEP_LIMIT = 20;
const DECLARATION_TOOL_NAME = "declareAuthoringGoal";

/** Per-turn, per-request config consumed by ScopeManager. */
export interface AuthoringScopeTurnConfig {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  promptText?: string | null;
  intent?: AuthoringIntent | null;
  approvalEvent?: AuthoringApprovalEvent | null;
  currentDocumentHash?: string | null;
  loadFailures?: { datasources?: boolean; skills?: boolean } | null;
  rejectedProposalIds?: readonly string[] | null;
  permissions?: ReadonlySet<string> | readonly string[] | null;
}

export interface AuthoringScopeManagerDeps {
  ledgerSink: AuthoringLedgerSink;
  getToolSet: () => Record<string, AuthoringToolDefinition>;
  getDraftStatusSnapshot: () => DraftStatusToolOutput;
  getApprovalContext: () => { approved: boolean };
  getRuntimeMessages: () => AgentMessage[];
  onScopeResolved?: (scope: AuthoringScopeCapabilities) => void;
  baseThinkingLevel?: ThinkingLevel | (() => ThinkingLevel);
}

/**
 * Manages the capability scope and tool surface state for an authoring agent session.
 * Responsible for scope recomputation after each tool call and for updating the
 * Agent's tools/systemPrompt whenever the surface changes.
 */
export class AuthoringScopeManager {
  private scope!: AuthoringScopeCapabilities;
  private surface!: RuntimeToolSurface;
  private lastSurfaceDigest: string | null = null;
  private lastSurfaceLedgerKey: string | null = null;
  private stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }> = [];
  private forceChatOnlyForTurn = false;
  /** True after the first applySurfaceToAgent call within the current turn. */
  private turnStarted = false;
  /** Proposal IDs that have been rejected; persists across turns so stale drafts don't block authoring. */
  private readonly rejectedProposalIds: Set<string> = new Set();
  lastContextFingerprint: string = "";

  private turnConfig!: AuthoringScopeTurnConfig;
  private readonly deps: AuthoringScopeManagerDeps;

  constructor(
    initialTurnConfig: AuthoringScopeTurnConfig,
    deps: AuthoringScopeManagerDeps,
  ) {
    this.deps = deps;
    this.applyTurnConfigSideEffects(initialTurnConfig);
    this.turnConfig = initialTurnConfig;
    this.scope = this.computeScope();
    this.surface = this.buildSurfaceFromScope(this.scope);
  }

  /** Update per-turn config (called at the start of each new request). */
  setTurnConfig(config: AuthoringScopeTurnConfig): void {
    this.applyTurnConfigSideEffects(config);
    this.turnConfig = config;
  }

  private applyTurnConfigSideEffects(config: AuthoringScopeTurnConfig): void {
    for (const proposalId of config.rejectedProposalIds ?? []) {
      this.addRejectedProposalId(proposalId);
    }
    if (config.approvalEvent?.decision === "reject") {
      this.addRejectedProposalId(config.approvalEvent.proposalId);
    }
  }

  private static readonly REJECTED_PROPOSAL_IDS_MAX = 100;

  private addRejectedProposalId(proposalId: string | null | undefined): void {
    const normalized = proposalId?.trim();
    if (!normalized) return;
    this.rejectedProposalIds.add(normalized);
    if (this.rejectedProposalIds.size > AuthoringScopeManager.REJECTED_PROPOSAL_IDS_MAX) {
      const oldest = this.rejectedProposalIds.values().next().value;
      if (oldest !== undefined) {
        this.rejectedProposalIds.delete(oldest);
      }
    }
  }

  /** Reset per-turn state. Call at the very start of each turn. */
  resetForTurn(): void {
    this.stepHistoryInTurn = [];
    this.forceChatOnlyForTurn = false;
    // Clear the turn-start flag so the first applySurfaceToAgent of this new
    // turn does NOT carry forward the previous turn's profile as lockedProfile.
    this.turnStarted = false;
  }

  getCurrentSurface(): RuntimeToolSurface {
    return this.surface;
  }

  getCurrentScope(): AuthoringScopeCapabilities {
    return this.scope;
  }

  getCurrentThinkingLevel(): ThinkingLevel {
    return this.resolveThinkingLevelForMode();
  }

  getActiveToolNames(): ReadonlySet<string> {
    return new Set(this.surface.activeTools);
  }

  getLastSurfaceDigest(): string | null {
    return this.lastSurfaceDigest;
  }

  setLastSurfaceDigest(digest: string | null): void {
    this.lastSurfaceDigest = digest;
  }

  /** Record a tool result and update surface if composePatch/applyPatch succeeded. */
  onToolResult(toolName: string, isError: boolean): void {
    this.stepHistoryInTurn.push({ toolName, outcome: isError ? "error" : "ok" });
    if (
      !isError &&
      this.surface.mode === "inspect" &&
      this.hasExhaustedInspectReadBudget(toolName)
    ) {
      this.forceChatOnlyForTurn = true;
    }
    if (
      !isError &&
      this.surface.mode === "author" &&
      toolName !== DECLARATION_TOOL_NAME
    ) {
      const totalSteps = this.stepHistoryInTurn.filter(
        (step) => step.outcome === "ok" && step.toolName !== DECLARATION_TOOL_NAME,
      ).length;
      if (totalSteps >= AUTHOR_TOOL_STEP_LIMIT) {
        this.forceChatOnlyForTurn = true;
      }
    }
    if (!isError && (toolName === "composePatch" || toolName === "applyPatch")) {
      this.forceChatOnlyForTurn = true;
      this.surface = this.buildSurfaceFromScope(this.scope);
    }
    this.lastSurfaceDigest = null;
  }

  private hasExhaustedInspectReadBudget(toolName: string): boolean {
    const successfulInspectReads = this.stepHistoryInTurn.filter(
      (step) => step.outcome === "ok",
    );
    const repeatedToolSuccesses = successfulInspectReads.filter(
      (step) => step.toolName === toolName,
    ).length;
    return (
      repeatedToolSuccesses >= INSPECT_READ_TOOL_REPEAT_LIMIT ||
      successfulInspectReads.length >= INSPECT_READ_TOOL_TOTAL_LIMIT
    );
  }

  /** Compute pi-agent tools for the current surface. */
  buildPiTools() {
    return toPiAgentTools(
      selectAuthoringToolSet({
        tools: this.deps.getToolSet(),
        activeTools: this.surface.activeTools,
      }),
    );
  }

  buildSystemPrompt(surfaceOverride?: RuntimeToolSurface): string {
    const surface = surfaceOverride ?? this.surface;
    const meta = surfaceOverride
      ? this.buildToolPromptMetadataForSurface(surfaceOverride)
      : this.buildToolPromptMetadata();
    return buildAuthoringSystemPrompt({
      sections: surface.promptSections,
      scope: this.scope.scope,
      skills: this.turnConfig.skills,
      relevantSkillIds: this.scope.relevantSkillIds,
      draftStatus: this.deps.getDraftStatusSnapshot(),
      loadFailures: this.turnConfig.loadFailures,
      ...meta,
    });
  }

  buildContextBlock() {
    const facts = this.deriveFactsSnapshot();
    const block = buildAuthoringContextBlock({
      variant: this.scope.contextBlockVariant,
      dashboard: this.turnConfig.dashboard,
      dashboardId: this.turnConfig.dashboardId,
      focusedViewId:
        this.scope.scope.kind === "focused"
          ? this.scope.scope.viewId
          : this.turnConfig.focusedViewId,
      datasources: this.turnConfig.datasources,
      checks: this.turnConfig.checks,
      latestUserText: (this.turnConfig.promptText ?? "").trim(),
      intent: this.turnConfig.intent ?? null,
      draftStatus: this.deps.getDraftStatusSnapshot(),
      facts,
      scopeResolution: this.scope.scopeResolution,
      proposalSummary: facts.pendingProposal
        ? {
            proposal_id: facts.pendingProposal.proposalId,
            summary: facts.pendingProposal.summary,
            operation_count: facts.pendingProposal.operationCount,
          }
        : null,
    });
    this.lastContextFingerprint = block.fingerprint;
    return block;
  }

  deriveFactsSnapshot() {
    const messages = sanitizeAgentMessages(this.deps.getRuntimeMessages());
    const conversation = deriveConversationSignalsFromTranscript({
      messages,
      promptText: this.turnConfig.promptText ?? "",
      hasApprovalRequest: Boolean(this.turnConfig.approvalEvent),
      approvalDecision: this.turnConfig.approvalEvent?.decision ?? null,
      currentDocumentHash: this.turnConfig.currentDocumentHash ?? null,
      rejectedProposalIds: this.rejectedProposalIds,
    });
    return deriveAuthoringFacts({
      messages,
      draftStatus: this.deps.getDraftStatusSnapshot(),
      approvalEvent: this.turnConfig.approvalEvent,
      latestDraftOutput: conversation.latestDraftOutput,
    });
  }

  /**
   * Recompute scope/surface, update agent state (tools + systemPrompt), and write a
   * ledger entry when the surface configuration changes. Call after every tool result
   * and at turn start.
   */
  private resolveThinkingLevelForMode(): ThinkingLevel {
    const base =
      typeof this.deps.baseThinkingLevel === "function"
        ? this.deps.baseThinkingLevel()
        : this.deps.baseThinkingLevel ?? "medium";
    if (base === "off") return "off";
    return this.surface.mode === "author" ? base : "low";
  }

  async applySurfaceToAgent(
    agent: { state: { tools: unknown; systemPrompt: string; thinkingLevel?: ThinkingLevel } } | null,
    context?: AgentContext,
  ): Promise<void> {
    const messages = sanitizeAgentMessages(this.deps.getRuntimeMessages());
    const conversation = deriveConversationSignalsFromTranscript({
      messages,
      promptText: this.turnConfig.promptText ?? "",
      hasApprovalRequest: Boolean(this.turnConfig.approvalEvent),
      approvalDecision: this.turnConfig.approvalEvent?.decision ?? null,
      currentDocumentHash: this.turnConfig.currentDocumentHash ?? null,
      rejectedProposalIds: this.rejectedProposalIds,
    });
    // Lock the profile only after the first computation of this turn so that
    // a new turn always re-derives its starting profile from scratch rather
    // than being pinned to the previous turn's final profile.
    const lockedProfile = this.turnStarted ? this.scope.profile : null;
    const decision = computeAuthoringScope(
      buildScopeInput({
        dashboard: this.turnConfig.dashboard,
        dashboardId: this.turnConfig.dashboardId,
        datasources: this.turnConfig.datasources,
        conversation,
        focusedViewId: this.turnConfig.focusedViewId,
        checks: this.turnConfig.checks,
        skills: this.turnConfig.skills,
        intent: this.turnConfig.intent,
        stepHistoryInTurn: this.stepHistoryInTurn,
        lockedProfile,
        permissions: this.turnConfig.permissions ?? null,
      }),
    );
    this.turnStarted = true;
    this.scope = decision;
    this.surface = this.buildSurfaceFromScope(decision);
    this.deps.onScopeResolved?.(decision);

    const facts = this.deriveFactsSnapshot();
    const piTools = this.buildPiTools();
    const systemPrompt = this.buildSystemPrompt();

    if (agent) {
      agent.state.tools = piTools as never;
      agent.state.systemPrompt = systemPrompt;
      agent.state.thinkingLevel = this.resolveThinkingLevelForMode();
    }
    if (context) {
      context.tools = piTools as never;
      context.systemPrompt = systemPrompt;
    }

    const ledger = this.deps.ledgerSink;
    await ledger.trace("authoring-agent", "prepare-step", {
      sessionId: ledger.getRunContext().sessionId,
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
      const ctx = ledger.getRunContext();
      await ledger.write(
        buildSurfaceLedgerEvent({
          seq: ledger.nextSeq(),
          runId: ctx.runId,
          sessionId: ctx.sessionId,
          dashboardId: ctx.dashboardId,
          turnId: ctx.turnId,
          startedAtMs: ctx.startedAtMs,
          surface: this.surface,
          profile: this.scope.profile,
          scope: this.scope.scope,
          facts,
          contextFingerprint: this.lastContextFingerprint,
        }),
      );
    }
    this.lastSurfaceDigest = surfaceConfigDigest(this.surface);
  }

  private computeScope(): AuthoringScopeCapabilities {
    const messages = sanitizeAgentMessages(this.deps.getRuntimeMessages());
    const conversation = deriveConversationSignalsFromTranscript({
      messages,
      promptText: this.turnConfig.promptText ?? "",
      hasApprovalRequest: Boolean(this.turnConfig.approvalEvent),
      approvalDecision: this.turnConfig.approvalEvent?.decision ?? null,
      currentDocumentHash: this.turnConfig.currentDocumentHash ?? null,
      rejectedProposalIds: this.rejectedProposalIds,
    });
    return computeAuthoringScope(
      buildScopeInput({
        dashboard: this.turnConfig.dashboard,
        dashboardId: this.turnConfig.dashboardId,
        datasources: this.turnConfig.datasources,
        conversation,
        focusedViewId: this.turnConfig.focusedViewId,
        checks: this.turnConfig.checks,
        skills: this.turnConfig.skills,
        intent: this.turnConfig.intent,
        permissions: this.turnConfig.permissions ?? null,
      }),
    );
  }

  private buildSurfaceFromScope(decision: AuthoringScopeCapabilities): RuntimeToolSurface {
    const facts = this.deriveFactsSnapshot();
    const approvalContext = this.deps.getApprovalContext();
    if (this.turnConfig.approvalEvent?.decision === "approve" && !approvalContext.approved) {
      throw new Error(
        "Invalid approval event reached authoring agent runtime after preflight.",
      );
    }
    return resolveRuntimeToolSurface({
      decision,
      draft: facts.draft,
      approval: { decision: this.turnConfig.approvalEvent?.decision ?? null },
      forceChatOnlyForTurn: this.forceChatOnlyForTurn,
    });
  }

  private buildToolPromptMetadata() {
    return this.buildToolPromptMetadataForSurface(this.surface);
  }

  private buildToolPromptMetadataForSurface(surface: RuntimeToolSurface) {
    const selectedTools = selectAuthoringToolSet({
      tools: this.deps.getToolSet(),
      activeTools: surface.activeTools,
    });
    const defs = Object.values(selectedTools);
    return {
      toolPromptSnippets: uniqueNonEmpty(defs.map((d) => d.promptSnippet)),
      toolPromptContracts: uniqueNonEmpty(defs.map((d) => formatAuthoringToolContract(d))),
      toolPromptGuidelines: uniqueNonEmpty(defs.flatMap((d) => d.promptGuidelines ?? [])),
    };
  }

  /**
   * Injects turn-local state for unit tests that need to simulate mid-turn conditions
   * (e.g. pre-populated step history or a forced chat-only turn) without running a real
   * agent loop. Not intended for production use.
   */
  setTurnStateForTest(state: {
    stepHistoryInTurn?: Array<{ toolName: string; outcome: "ok" | "error" }>;
    forceChatOnlyForTurn?: boolean;
  }): void {
    if (state.stepHistoryInTurn !== undefined) {
      this.stepHistoryInTurn = state.stepHistoryInTurn;
    }
    if (state.forceChatOnlyForTurn !== undefined) {
      this.forceChatOnlyForTurn = state.forceChatOnlyForTurn;
    }
  }
}

function uniqueNonEmpty(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
