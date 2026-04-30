import { createHash } from "node:crypto";
import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
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
  buildApprovalState,
  buildRuntimeCheckStatus,
  explicitEventIntent,
  resumeIntentForGoal,
} from "@/ai/authoring/agent/workflow-bridge";
import { buildScopeInput } from "@/ai/authoring/agent/scope-input";
import {
  applyWorkflowTransition,
  getActiveGoal,
  inspectArtifacts,
  normalizeAuthoringWorkflowState,
  reduceIntentToAuthoringWorkflowState,
} from "@/ai/authoring/workflow";
import type {
  TurnIntent,
  AuthoringWorkflowState,
} from "@/ai/authoring/workflow/types";
import {
  convertToLlm,
  sanitizeAgentMessages,
  transformAuthoringContext,
} from "@/ai/authoring/runtime/llm-boundary";
import { toPiAgentTools } from "@/ai/authoring/runtime/pi-tool-adapter";

const DEFAULT_WALL_CLOCK_MS = 60_000;
const DEFAULT_REASONING_WALL_CLOCK_MS = 180_000;

export interface AuthoringAgentProtocolEvent {
  protocol: "authoring-agent-v1";
  event: AgentEvent;
}

export interface AuthoringAgentFinishPayload {
  agentMessages: AgentMessage[];
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveWallClockTimeout(runtime: {
  thinkingLevel: string;
}): number {
  const envMs = parsePositiveInteger(process.env.AUTHORING_AGENT_WALL_CLOCK_MS);
  if (envMs) {
    return envMs;
  }

  return runtime.thinkingLevel === "off"
    ? DEFAULT_WALL_CLOCK_MS
    : DEFAULT_REASONING_WALL_CLOCK_MS;
}

function createProviderSessionId(sessionId: string | undefined): string | undefined {
  if (!sessionId) {
    return undefined;
  }
  if (sessionId.length <= 64) {
    return sessionId;
  }
  return `authoring-${createHash("sha256").update(sessionId).digest("hex").slice(0, 54)}`;
}

function encodeProtocolEvent(event: AuthoringAgentProtocolEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
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
  let currentWorkflowIntent: TurnIntent | null =
    explicitWorkflowIntent ?? resumeIntentForGoal(getActiveGoal(currentAuthoringWorkflowState));
  const runtimeApprovedProposalId =
    input.approvalEvent?.decision === "approve"
      ? input.approvalEvent.proposalId
      : null;

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
      const { declarationToTurnIntent } = await import("@/ai/authoring/agent/workflow-bridge");
      const declaredIntent = declarationToTurnIntent(declaration);
      currentAuthoringWorkflowState = normalizeAuthoringWorkflowState(reduceIntentToAuthoringWorkflowState({
        state: currentAuthoringWorkflowState,
        intent: declaredIntent,
        turnId: input.turnId ?? input.sessionId ?? "turn",
        pendingProposalId: initialLatestDraft?.suggestion.id,
        pendingProposalBaseVersion: initialLatestDraft?.base_version ?? input.baseVersion,
        pendingProposalDraftFingerprint: initialLatestDraft?.draft_fingerprint,
      }));
      currentWorkflowIntent = declaredIntent;
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
    hasRuntimeApproval: () =>
      Boolean(
        runtimeApprovedProposalId &&
          runtimeApprovedProposalId === currentAuthoringWorkflowState.pendingProposalId,
      ),
  });

  const initialDraftStatus = toolRuntime.getDraftStatusSnapshot();
  const initialDraftSnapshot = toolRuntime.getDraftSnapshot();
  const initialArtifactStatus = inspectArtifacts({
    goal: getActiveGoal(currentAuthoringWorkflowState),
    candidate: toolRuntime.getCandidateDocumentSnapshot(),
    candidateFingerprint: toolRuntime.getCandidateDocumentFingerprintSnapshot(),
    ownership: initialDraftSnapshot?.ownership,
    runtimeCheck: buildRuntimeCheckStatus({
      draftStatus: initialDraftStatus,
      goal: getActiveGoal(currentAuthoringWorkflowState),
    }),
    pendingProposalId: currentAuthoringWorkflowState.pendingProposalId,
    pendingProposalDraftFingerprint: currentAuthoringWorkflowState.pendingProposalDraftFingerprint,
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
    latestUserText: promptText || initialConversation.latestUserText,
    intent: input.intent ?? null,
    draftStatus: initialDraftStatus,
    workflowState: currentAuthoringWorkflowState,
    artifactStatus: initialArtifactStatus,
    scopeResolution: initialDecision.scopeResolution,
    proposalSummary: initialLatestDraft
      ? {
          proposal_id: initialLatestDraft.suggestion.id,
          summary: initialLatestDraft.suggestion.summary,
          operation_count: initialLatestDraft.suggestion.patch.operations.length,
        }
      : null,
  });

  const agent = new Agent({
    initialState: {
      model: runtime.model,
      thinkingLevel: runtime.thinkingLevel,
      systemPrompt: buildAuthoringSystemPrompt({
        sections: getActiveGoal(currentAuthoringWorkflowState)
          ? ["identity", "workflow"]
          : ["identity", "inspect"],
        scope: initialDecision.scope,
        skills: input.skills,
        relevantSkillIds: initialDecision.relevantSkillIds,
        draftStatus: initialDraftStatus,
        loadFailures: input.loadFailures,
      }),
      tools: toPiAgentTools(toolRuntime.tools),
      messages: transcript,
    },
    sessionId: createProviderSessionId(input.sessionId),
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
        contextMarkdown: contextBlock.markdown,
      });
    },
    convertToLlm: async (messages) => convertToLlm(messages),
    afterToolCall: async ({ toolCall, result, isError }) => {
      const toolResults = [
        {
          toolName: toolCall.name,
          output: result.details,
          error: isError
            ? result.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n")
            : undefined,
        },
      ];
      currentAuthoringWorkflowState = applyWorkflowTransition({
        state: currentAuthoringWorkflowState,
        action: { kind: "answer", reason: "pi_tool_completed" },
        toolExecution: {
          status: isError ? "failed" : "succeeded",
          toolName: toolCall.name as never,
          message: isError ? "Tool execution failed." : "Tool execution completed.",
        } as never,
        baseVersion: input.baseVersion,
        contextStatus: toolRuntime.getContextStatusSnapshot(
          getActiveGoal(currentAuthoringWorkflowState),
        ),
      });
      void toolResults;
      return undefined;
    },
    onPayload: async (payload) => {
      await writeAuthoringTrace(
        input.dependencies!,
        "authoring-agent",
        "provider_payload",
        {
          sessionId: input.sessionId,
          provider: runtime.providerKind,
          containsProviderRuntimeMetadata:
            JSON.stringify(payload).includes("providerMetadata") ||
            JSON.stringify(payload).includes("providerOptions") ||
            JSON.stringify(payload).includes("item_reference"),
        },
      );
      return undefined;
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false;
      const wallTimer = setTimeout(() => {
        if (!finished) {
          agent.abort();
        }
      }, input.wallClockTimeoutMs ?? resolveWallClockTimeout(runtime));

      const abort = () => agent.abort();
      input.abortSignal?.addEventListener("abort", abort, { once: true });

      agent.subscribe(async (event) => {
        controller.enqueue(
          encodeProtocolEvent({
            protocol: "authoring-agent-v1",
            event,
          }),
        );

        if (event.type === "tool_execution_end") {
          await writeAuthoringTrace(
            input.dependencies!,
            "authoring-agent",
            "tool_execution_end",
            {
              sessionId: input.sessionId,
              toolName: event.toolName,
              hasError: event.isError,
            },
          );
        }

        if (event.type === "agent_end") {
          finished = true;
          clearTimeout(wallTimer);
          input.abortSignal?.removeEventListener("abort", abort);
          await writeAuthoringTrace(
            input.dependencies!,
            "authoring-agent",
            "turn_finish",
            {
              sessionId: input.sessionId,
              messageCount: agent.state.messages.length,
              errorMessage: agent.state.errorMessage ?? null,
              lastMessageRole:
                agent.state.messages[agent.state.messages.length - 1]?.role ?? null,
            },
          );
          await input.onFinish?.({
            agentMessages: agent.state.messages,
          });
          controller.close();
        }
      });

      if (!promptText) {
        void agent.continue().catch((error) => {
          clearTimeout(wallTimer);
          controller.error(error);
        });
      } else {
        void agent.prompt(promptText).catch((error) => {
          clearTimeout(wallTimer);
          controller.error(error);
        });
      }
    },
    cancel() {
      agent.abort();
    },
  });

  return {
    stream,
    getAgentMessagesSnapshot: () => agent.state.messages,
    getDraftSnapshot: toolRuntime.getDraftSnapshot,
    getLastRunCheckStateSnapshot: toolRuntime.getLastRunCheckStateSnapshot,
    getAuthoringWorkflowStateSnapshot: () => currentAuthoringWorkflowState,
    contextFingerprint: contextBlock.fingerprint,
  };
}
