import type {
  AgentEvent,
  AgentMessage,
} from "@mariozechner/pi-agent-core";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  AuthoringCapabilityProfile,
  AuthoringScope,
  AuthoringToolChoice,
  AuthoringToolName,
} from "@/ai/authoring/contracts/runtime";
import type { AuthoringWorkflowState } from "@/ai/authoring/workflow/types";
import { getActiveGoal } from "@/ai/authoring/workflow/index";
import type { RuntimeToolSurface } from "@/ai/authoring/agent/tool-surface";

export type AuthoringAgentLedgerEventKind =
  | "pi_event"
  | "provider_boundary"
  | "surface";

export interface AuthoringAgentProviderBoundarySummary {
  provider: string;
  modelId: string;
  thinkingLevel: string;
  safe: boolean;
  reason: string | null;
  path: string | null;
}

export interface AuthoringAgentLedgerEvent {
  ts: string;
  seq: number;
  runId: string;
  sessionId?: string | null;
  dashboardId?: string | null;
  turnId?: string | null;
  kind: AuthoringAgentLedgerEventKind;
  piEventType?: AgentEvent["type"];
  durationMs: number;
  surfaceMode: RuntimeToolSurface["mode"];
  surfaceReason?: RuntimeToolSurface["reason"] | null;
  profile: AuthoringCapabilityProfile;
  scope: {
    kind: AuthoringScope["kind"];
    viewId?: string | null;
  };
  actionKind?: string | null;
  activeTools: AuthoringToolName[];
  toolChoice: AuthoringToolChoice;
  contextFingerprint?: string | null;
  workflow: {
    activeGoalId: string | null;
    activeGoalStatus: string | null;
    pendingProposalId: string | null;
    pendingProposalBaseVersion: number | null;
    goalCount: number;
  };
  message?: {
    role: string;
    textLength?: number;
    thinkingLength?: number;
    toolCalls?: Array<{ toolCallId: string; toolName: string }>;
    errorMessage?: string | null;
  };
  toolCall?: {
    toolCallId: string;
    toolName: string;
    argKeys?: string[];
    argsHash?: string;
  };
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    isError: boolean;
    summary: string;
  }>;
  providerBoundary?: AuthoringAgentProviderBoundarySummary;
  errorSummary?: string | null;
}

const LEDGER_DETAIL_KEY_DENYLIST = new Set([
  "dashboard",
  "dashboard_spec",
  "query_defs",
  "bindings",
  "sql_template",
  "option_template",
  "providerOptions",
  "providerMetadata",
  "callProviderMetadata",
  "resultProviderMetadata",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

function compactText(value: unknown, limit = 240): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const redacted = value
    .replace(/\b(?:rs|msg|fc)_[A-Za-z0-9_-]+\b/g, "[provider-ref]")
    .replace(
      /\b(dashboard_spec|query_defs|bindings|sql_template|option_template)\b/g,
      "[redacted-field]",
    );
  const compacted = redacted.trim().replace(/\s+/g, " ");
  if (!compacted) {
    return null;
  }
  return compacted.length > limit ? `${compacted.slice(0, limit)}...` : compacted;
}

function stableHash(value: unknown): string | undefined {
  let text = "";
  try {
    text = JSON.stringify(value);
  } catch {
    return undefined;
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizeMessage(message: AgentMessage): AuthoringAgentLedgerEvent["message"] {
  if (message.role === "assistant" && Array.isArray(message.content)) {
    const toolCalls = message.content
      .filter((part) => part.type === "toolCall")
      .map((part) => ({
        toolCallId: part.id,
        toolName: part.name,
      }));
    return {
      role: message.role,
      textLength: message.content
        .filter((part) => part.type === "text")
        .reduce((sum, part) => sum + textLength(part.text), 0),
      thinkingLength: message.content
        .filter((part) => part.type === "thinking")
        .reduce((sum, part) => sum + textLength(part.thinking), 0),
      ...(toolCalls.length ? { toolCalls } : {}),
      errorMessage:
        typeof message.errorMessage === "string"
          ? compactText(message.errorMessage)
          : null,
    };
  }
  if (message.role === "user") {
    const content = Array.isArray(message.content)
      ? message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
      : message.content;
    return {
      role: message.role,
      textLength: content.length,
    };
  }
  if (message.role === "toolResult") {
    const result = message as ToolResultMessage;
    return {
      role: message.role,
      toolCalls: [
        {
          toolCallId: result.toolCallId,
          toolName: result.toolName,
        },
      ],
      errorMessage: result.isError ? summarizeToolResult(result) : null,
    };
  }
  return { role: String(message.role) };
}

function summarizeDetails(toolName: string, details: unknown): string {
  if (!isRecord(details)) {
    return `${toolName} result`;
  }
  if (toolName === "composePatch") {
    const suggestion = isRecord(details.suggestion) ? details.suggestion : {};
    const patch = isRecord(suggestion.patch) ? suggestion.patch : {};
    const operations = Array.isArray(patch.operations) ? patch.operations : [];
    return [
      `proposal=${compactText(suggestion.id, 80) ?? "unknown"}`,
      `ops=${operations.length}`,
      `base=${typeof details.base_version === "number" ? details.base_version : "none"}`,
      `hasDashboard=${isRecord(suggestion.dashboard)}`,
    ].join(" ");
  }
  if (toolName === "applyPatch") {
    return [
      `applied=${details.applied === true}`,
      `suggestion=${compactText(details.suggestion_id, 80) ?? "unknown"}`,
      `hasDashboard=${isRecord(details.dashboard)}`,
    ].join(" ");
  }
  if (toolName === "runCheck") {
    return [
      `status=${compactText(details.status, 40) ?? "unknown"}`,
      `failures=${Array.isArray(details.failures) ? details.failures.length : 0}`,
      `checks=${Array.isArray(details.checks) ? details.checks.length : 0}`,
    ].join(" ");
  }
  const summary = compactText(details.summary);
  if (summary) {
    return summary;
  }
  const safeKeys = Object.keys(details)
    .filter((key) => !LEDGER_DETAIL_KEY_DENYLIST.has(key))
    .slice(0, 12);
  return safeKeys.length ? `keys=${safeKeys.join(",")}` : `${toolName} result`;
}

function summarizeToolResult(result: {
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  content?: unknown;
  details?: unknown;
}): string {
  if (result.isError) {
    const contentText = Array.isArray(result.content)
      ? result.content
          .filter((part): part is { type: string; text: string } =>
            isRecord(part) && part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text)
          .join("\n")
      : "";
    return compactText(contentText) ?? "tool error";
  }
  return summarizeDetails(result.toolName ?? "tool", result.details);
}

function summarizeToolResults(
  results: ToolResultMessage[] | undefined,
): AuthoringAgentLedgerEvent["toolResults"] {
  return results?.map((result) => ({
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    isError: result.isError,
    summary: summarizeToolResult(result),
  }));
}

function eventToolResults(event: AgentEvent): AuthoringAgentLedgerEvent["toolResults"] {
  if (event.type === "turn_end") {
    return summarizeToolResults(event.toolResults);
  }
  if (event.type === "tool_execution_end") {
    return [
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        summary: summarizeToolResult({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          content: event.result?.content,
          details: event.result?.details,
        }),
      },
    ];
  }
  return undefined;
}

function eventToolCall(event: AgentEvent): AuthoringAgentLedgerEvent["toolCall"] {
  if (
    event.type !== "tool_execution_start" &&
    event.type !== "tool_execution_update" &&
    event.type !== "tool_execution_end"
  ) {
    return undefined;
  }
  return {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    ...(event.type !== "tool_execution_end" && isRecord(event.args)
      ? { argKeys: Object.keys(event.args).slice(0, 16), argsHash: stableHash(event.args) }
      : {}),
  };
}

function eventMessage(event: AgentEvent): AuthoringAgentLedgerEvent["message"] {
  if (
    event.type === "message_start" ||
    event.type === "message_update" ||
    event.type === "message_end" ||
    event.type === "turn_end"
  ) {
    return summarizeMessage(event.message);
  }
  if (event.type === "agent_end") {
    return {
      role: "agent",
      textLength: event.messages.length,
    };
  }
  return undefined;
}

function workflowSummary(workflowState: AuthoringWorkflowState) {
  const activeGoal = getActiveGoal(workflowState);
  return {
    activeGoalId: activeGoal?.id ?? null,
    activeGoalStatus: activeGoal?.status ?? null,
    pendingProposalId: workflowState.pendingProposalId ?? null,
    pendingProposalBaseVersion:
      typeof workflowState.pendingProposalBaseVersion === "number"
        ? workflowState.pendingProposalBaseVersion
        : null,
    goalCount: workflowState.goals.length,
  };
}

export function buildPiEventLedgerEvent(input: {
  event: AgentEvent;
  seq: number;
  runId: string;
  sessionId?: string | null;
  dashboardId?: string | null;
  turnId?: string | null;
  startedAtMs: number;
  surface: RuntimeToolSurface;
  profile: AuthoringCapabilityProfile;
  scope: AuthoringScope;
  workflowState: AuthoringWorkflowState;
  contextFingerprint?: string | null;
}): AuthoringAgentLedgerEvent {
  return {
    ts: new Date().toISOString(),
    seq: input.seq,
    runId: input.runId,
    sessionId: input.sessionId ?? null,
    dashboardId: input.dashboardId ?? null,
    turnId: input.turnId ?? null,
    kind: "pi_event",
    piEventType: input.event.type,
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    surfaceMode: input.surface.mode,
    surfaceReason: input.surface.reason ?? null,
    profile: input.profile,
    scope: {
      kind: input.scope.kind,
      viewId: input.scope.kind === "focused" ? input.scope.viewId : null,
    },
    actionKind: input.surface.action?.kind ?? null,
    activeTools: [...input.surface.activeTools],
    toolChoice: input.surface.toolChoice,
    contextFingerprint: input.contextFingerprint ?? null,
    workflow: workflowSummary(input.workflowState),
    message: eventMessage(input.event),
    toolCall: eventToolCall(input.event),
    toolResults: eventToolResults(input.event),
    errorSummary:
      input.event.type === "agent_end"
        ? null
        : input.event.type === "tool_execution_end" && input.event.isError
          ? eventToolResults(input.event)?.[0]?.summary ?? "tool error"
          : null,
  };
}

export function buildProviderBoundaryLedgerEvent(input: {
  seq: number;
  runId: string;
  sessionId?: string | null;
  dashboardId?: string | null;
  turnId?: string | null;
  startedAtMs: number;
  surface: RuntimeToolSurface;
  profile: AuthoringCapabilityProfile;
  scope: AuthoringScope;
  workflowState: AuthoringWorkflowState;
  contextFingerprint?: string | null;
  providerBoundary: AuthoringAgentProviderBoundarySummary;
}): AuthoringAgentLedgerEvent {
  return {
    ts: new Date().toISOString(),
    seq: input.seq,
    runId: input.runId,
    sessionId: input.sessionId ?? null,
    dashboardId: input.dashboardId ?? null,
    turnId: input.turnId ?? null,
    kind: "provider_boundary",
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    surfaceMode: input.surface.mode,
    surfaceReason: input.surface.reason ?? null,
    profile: input.profile,
    scope: {
      kind: input.scope.kind,
      viewId: input.scope.kind === "focused" ? input.scope.viewId : null,
    },
    actionKind: input.surface.action?.kind ?? null,
    activeTools: [...input.surface.activeTools],
    toolChoice: input.surface.toolChoice,
    contextFingerprint: input.contextFingerprint ?? null,
    workflow: workflowSummary(input.workflowState),
    providerBoundary: input.providerBoundary,
    errorSummary: input.providerBoundary.safe
      ? null
      : input.providerBoundary.reason,
  };
}

export function buildSurfaceLedgerEvent(input: {
  seq: number;
  runId: string;
  sessionId?: string | null;
  dashboardId?: string | null;
  turnId?: string | null;
  startedAtMs: number;
  surface: RuntimeToolSurface;
  profile: AuthoringCapabilityProfile;
  scope: AuthoringScope;
  workflowState: AuthoringWorkflowState;
  contextFingerprint?: string | null;
}): AuthoringAgentLedgerEvent {
  return {
    ts: new Date().toISOString(),
    seq: input.seq,
    runId: input.runId,
    sessionId: input.sessionId ?? null,
    dashboardId: input.dashboardId ?? null,
    turnId: input.turnId ?? null,
    kind: "surface",
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    surfaceMode: input.surface.mode,
    surfaceReason: input.surface.reason ?? null,
    profile: input.profile,
    scope: {
      kind: input.scope.kind,
      viewId: input.scope.kind === "focused" ? input.scope.viewId : null,
    },
    actionKind: input.surface.action?.kind ?? null,
    activeTools: [...input.surface.activeTools],
    toolChoice: input.surface.toolChoice,
    contextFingerprint: input.contextFingerprint ?? null,
    workflow: workflowSummary(input.workflowState),
  };
}
