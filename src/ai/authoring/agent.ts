import { Agent, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import type { DashboardDocument } from "@/contracts";
import { resolveProviderModelConfig } from "@/ai/providers/index";
import type {
  AuthoringApprovalEvent,
  AuthoringIntent,
  AuthoringMessage,
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
  deriveConversationSignalsFromUiMessages,
} from "@/ai/authoring/messages/conversation-signals";
import { findLatestDraftOutput } from "@/ai/authoring/messages/inspection";
import { sanitizeAuthoringMessages } from "@/ai/authoring/messages/ui-message-sanitize";
import { createValidationOnlyAuthoringDependencies, writeAuthoringTrace } from "@/ai/authoring/runtime/dependencies";
import {
  buildApprovalStateV2,
  buildRuntimeCheckStatusV2,
  explicitEventIntentV2,
  resumeIntentForGoalV2,
} from "@/ai/authoring/agent/workflow-bridge";
import { buildScopeInput } from "@/ai/authoring/agent/scope-input";
import {
  applyWorkflowTransitionV2,
  getActiveGoalV2,
  inspectArtifactsV2,
  normalizeWorkflowStateV2,
  reduceIntentToWorkflowStateV2,
} from "@/ai/authoring/v2";
import type {
  TurnIntentV2,
  WorkflowStateV2,
} from "@/ai/authoring/v2/types";
import {
  agentMessagesToAuthoringUiMessages,
  authoringUiMessagesToAgentMessages,
  convertAuthoringMessagesToLlm,
  sanitizeAgentMessages,
  transformAuthoringContext,
} from "@/ai/authoring/runtime/pi-messages";
import { toPiAgentTools } from "@/ai/authoring/runtime/pi-tool-adapter";

const DEFAULT_WALL_CLOCK_MS = 60_000;
const DEFAULT_REASONING_WALL_CLOCK_MS = 180_000;

export interface AuthoringAgentProtocolEvent {
  protocol: "authoring-agent-v1";
  event: AgentEvent;
  messages: AuthoringMessage[];
}

export interface AuthoringAgentFinishPayload {
  agentMessages: AgentMessage[];
  uiMessages: AuthoringMessage[];
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

function textFromMessage(message: AuthoringMessage): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

function latestUserText(messages: AuthoringMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      const text = textFromMessage(message);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function createUiMessageId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function findLastAssistantMessage(messages: AuthoringMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      return messages[index];
    }
  }
  const assistant: AuthoringMessage = {
    id: createUiMessageId("a"),
    role: "assistant",
    parts: [],
  };
  messages.push(assistant);
  return assistant;
}

function upsertAssistantText(
  uiMessages: AuthoringMessage[],
  assistant: AssistantMessage,
) {
  const message = findLastAssistantMessage(uiMessages);
  const text = assistant.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const thinking = assistant.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("");

  const nonText = message.parts.filter(
    (part) => part.type !== "text" && part.type !== "reasoning",
  );
  message.parts = [
    ...(thinking ? [{ type: "reasoning" as const, text: thinking }] : []),
    ...(text ? [{ type: "text" as const, text }] : []),
    ...nonText,
  ];
}

function upsertToolPart(
  uiMessages: AuthoringMessage[],
  input: {
    toolCallId: string;
    toolName: string;
    state: string;
    args?: unknown;
    output?: unknown;
    errorText?: string;
  },
) {
  const message = findLastAssistantMessage(uiMessages);
  const type = `tool-${input.toolName}` as const;
  const existingIndex = message.parts.findIndex(
    (part) =>
      part.type === type &&
      "toolCallId" in part &&
      part.toolCallId === input.toolCallId,
  );
  const part = {
    type,
    state: input.state,
    toolCallId: input.toolCallId,
    ...(input.args !== undefined ? { input: input.args } : {}),
    ...(input.output !== undefined ? { output: input.output } : {}),
    ...(input.errorText ? { errorText: input.errorText } : {}),
  };

  if (existingIndex >= 0) {
    message.parts[existingIndex] = {
      ...message.parts[existingIndex],
      ...part,
    };
    return;
  }

  message.parts.push(part);
}

function applyAgentEventToUiMessages(
  uiMessages: AuthoringMessage[],
  event: AgentEvent,
) {
  if (event.type === "message_end" && event.message.role === "user") {
    const content = Array.isArray(event.message.content)
      ? event.message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
      : event.message.content;
    uiMessages.push({
      id: createUiMessageId("u"),
      role: "user",
      parts: [{ type: "text", text: content }],
    });
    return;
  }

  if (
    (event.type === "message_update" || event.type === "message_end") &&
    event.message.role === "assistant"
  ) {
    upsertAssistantText(uiMessages, event.message);
    return;
  }

  if (event.type === "tool_execution_start") {
    upsertToolPart(uiMessages, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: "input-available",
      args: event.args,
    });
    return;
  }

  if (event.type === "tool_execution_update") {
    upsertToolPart(uiMessages, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: "input-available",
      args: event.args,
      output: event.partialResult?.details ?? event.partialResult,
    });
    return;
  }

  if (event.type === "tool_execution_end") {
    upsertToolPart(uiMessages, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: event.isError ? "output-error" : "output-available",
      output: event.result?.details ?? event.result,
      errorText: event.isError
        ? String(
            event.result?.content
              ?.filter((part: { type: string }) => part.type === "text")
              .map((part: { text: string }) => part.text)
              .join("\n") || "Tool execution failed.",
          )
        : undefined,
    });
    return;
  }

  if (event.type === "message_end" && event.message.role === "toolResult") {
    const result = event.message as ToolResultMessage;
    upsertToolPart(uiMessages, {
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      state: result.isError ? "output-error" : "output-available",
      output: result.details,
      errorText: result.isError
        ? result.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : undefined,
    });
  }
}

function encodeProtocolEvent(event: AuthoringAgentProtocolEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function safeValidateMessages(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  messages: unknown;
  dependencies?: AuthoringDependencies;
}): Promise<
  | { success: true; data: AuthoringMessage[] }
  | { success: false; error: Error }
> {
  void input.dashboard;
  void input.dashboardId;
  void input.datasources;
  void input.dependencies;

  return {
    success: true,
    data: sanitizeAuthoringMessages(
      Array.isArray(input.messages) ? input.messages : [],
    ),
  };
}

export async function createAuthoringAgentStream(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  messages: AuthoringMessage[];
  agentMessages?: AgentMessage[] | null;
  uiMessages?: AuthoringMessage[] | null;
  promptText?: string | null;
  initialWorkingDraft?: AuthoringWorkingDraftSnapshot | null;
  initialLastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  initialWorkflowStateV2?: WorkflowStateV2 | null;
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

  const uiMessages = [
    ...(input.uiMessages ??
      (input.messages.length > 0 ? input.messages : agentMessagesToAuthoringUiMessages(input.agentMessages ?? []))),
  ];
  const transcript = sanitizeAgentMessages(
    input.agentMessages ?? authoringUiMessagesToAgentMessages(input.messages),
  );
  const promptText = (input.promptText ?? latestUserText(input.messages)).trim();
  const conversationForScope = promptText
    ? [
        ...uiMessages,
        {
          id: createUiMessageId("u_scope"),
          role: "user" as const,
          parts: [{ type: "text" as const, text: promptText }],
        },
      ]
    : uiMessages;
  const initialConversation =
    deriveConversationSignalsFromUiMessages(conversationForScope);
  const initialLatestDraft = findLatestDraftOutput(uiMessages);
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
      mode: getActiveGoalV2(currentWorkflowStateV2) ? "workflow" : "inspect",
      hasActiveGoal: Boolean(getActiveGoalV2(currentWorkflowStateV2)),
      hasPendingProposal: Boolean(currentWorkflowStateV2.pendingProposalId),
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
    messages: uiMessages,
    checks: input.checks,
    initialWorkingDraft: input.initialWorkingDraft,
    dependencies: input.dependencies,
    initialLastRunCheckState: input.initialLastRunCheckState,
    getActiveGoalId: () => getActiveGoalV2(currentWorkflowStateV2)?.id ?? null,
    getActiveGoal: () => getActiveGoalV2(currentWorkflowStateV2),
    getBaseVersion: () => input.baseVersion,
    onDeclareAuthoringGoal: async (declaration) => {
      const { declarationToTurnIntentV2 } = await import("@/ai/authoring/agent/workflow-bridge");
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
      const activeGoal = getActiveGoalV2(currentWorkflowStateV2);
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
    latestUserText: promptText || initialConversation.latestUserText,
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

  uiMessages.push({
    id: createUiMessageId("scope"),
    role: "assistant",
    parts: [
      {
        type: "data-authoring_scope",
        data: {
          ...initialDecision,
          contextFingerprint: contextBlock.fingerprint,
        },
      },
      ...(input.checks?.length
        ? [{ type: "data-authoring_checks" as const, data: input.checks }]
        : []),
    ],
  });

  const agent = new Agent({
    initialState: {
      model: runtime.model,
      thinkingLevel: runtime.thinkingLevel,
      systemPrompt: buildAuthoringSystemPrompt({
        sections: getActiveGoalV2(currentWorkflowStateV2)
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
    sessionId: input.sessionId,
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
    convertToLlm: async (messages) => convertAuthoringMessagesToLlm(messages),
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
      currentWorkflowStateV2 = applyWorkflowTransitionV2({
        state: currentWorkflowStateV2,
        action: { kind: "answer", reason: "pi_tool_completed" },
        toolExecution: {
          status: isError ? "failed" : "succeeded",
          toolName: toolCall.name as never,
          message: isError ? "Tool execution failed." : "Tool execution completed.",
        } as never,
        baseVersion: input.baseVersion,
        contextStatus: toolRuntime.getContextStatusSnapshot(
          getActiveGoalV2(currentWorkflowStateV2),
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
        applyAgentEventToUiMessages(uiMessages, event);
        controller.enqueue(
          encodeProtocolEvent({
            protocol: "authoring-agent-v1",
            event,
            messages: uiMessages,
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
            },
          );
          await input.onFinish?.({
            agentMessages: agent.state.messages,
            uiMessages,
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
    getUiMessagesSnapshot: () => uiMessages,
    getDraftSnapshot: toolRuntime.getDraftSnapshot,
    getLastRunCheckStateSnapshot: toolRuntime.getLastRunCheckStateSnapshot,
    getWorkflowStateV2Snapshot: () => currentWorkflowStateV2,
    contextFingerprint: contextBlock.fingerprint,
  };
}
