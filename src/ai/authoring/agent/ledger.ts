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
import type { RuntimeToolSurface } from "@/ai/authoring/agent/tool-surface";
import type { ProviderPayloadSummary } from "@/ai/authoring/agent/provider-observability";
import type { AuthoringDerivedFacts } from "@/ai/authoring/runtime/derived-facts";

export type AuthoringAgentLedgerEventKind =
  | "pi_event"
  | "provider_payload"
  | "surface";

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
  progress: {
    latestGoalKind: string | null;
    latestGoalAccepted: boolean | null;
    activeGoalId: string | null;
    pendingProposalId: string | null;
    pendingProposalBaseVersion: number | null;
    draftHasChanges: boolean | null;
    draftCanCompose: boolean | null;
    latestCheckStatus: string | null;
    approvalDecision: string | null;
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
  providerPayload?: ProviderPayloadSummary;
  errorSummary?: string | null;
}

export function shouldWritePiEventToLedger(event: AgentEvent): boolean {
  return event.type !== "message_update";
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

function redactProviderRuntimeRefs(value: string): string {
  return value.replace(/\b(?:rs|msg|fc)_[A-Za-z0-9_-]+\b/g, "[provider-ref]");
}

function redactToolCallId(toolCallId: string): string {
  return redactProviderRuntimeRefs(toolCallId);
}

function compactText(value: unknown, limit = 240): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const redacted = redactProviderRuntimeRefs(value).replace(
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
        toolCallId: redactToolCallId(part.id),
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
          toolCallId: redactToolCallId(result.toolCallId),
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
  if (toolName === "listDatasourceTables") {
    const tables = Array.isArray(details.tables)
      ? details.tables.filter(isRecord)
      : [];
    const tableNames = tables
      .map((table) => compactText(table.name, 40))
      .filter((name): name is string => Boolean(name))
      .slice(0, 12);
    return [
      `datasource=${compactText(details.datasource_id, 80) ?? "unknown"}`,
      `dialect=${compactText(details.dialect, 40) ?? "unknown"}`,
      `table_count=${typeof details.table_count === "number" ? details.table_count : tables.length}`,
      tableNames.length ? `tables=${tableNames.join(",")}` : "tables=none",
    ].join(" ");
  }
  if (toolName === "getTableSchema") {
    const table = isRecord(details.table) ? details.table : {};
    const fields = Array.isArray(details.fields)
      ? details.fields.filter(isRecord)
      : [];
    const fieldNames = fields
      .map((field) => compactText(field.name, 40))
      .filter((name): name is string => Boolean(name))
      .slice(0, 24);
    const commentCount = fields.filter(
      (field) =>
        compactText(field.comment, 80) ??
        compactText(field.description, 80),
    ).length;
    return [
      `datasource=${compactText(details.datasource_id, 80) ?? "unknown"}`,
      `table=${compactText(table.name, 120) ?? "unknown"}`,
      `field_count=${typeof details.field_count === "number" ? details.field_count : fields.length}`,
      `comments=${commentCount}`,
      fieldNames.length ? `fields=${fieldNames.join(",")}` : "fields=none",
    ].join(" ");
  }
  if (toolName === "previewTableData") {
    return [
      `datasource=${compactText(details.datasource_id, 80) ?? "unknown"}`,
      `table=${compactText(details.table, 120) ?? "unknown"}`,
      `limit=${typeof details.limit === "number" ? details.limit : "unknown"}`,
      `columns=${Array.isArray(details.columns) ? details.columns.length : 0}`,
      `rows=${Array.isArray(details.rows) ? details.rows.length : 0}`,
    ].join(" ");
  }
  if (toolName === "stageChart" || toolName === "stageDelete") {
    const artifacts = isRecord(details.artifact_ids) ? details.artifact_ids : {};
    const bindingIds = Array.isArray(artifacts.binding_ids)
      ? artifacts.binding_ids.length
      : 0;
    const removedViewIds = Array.isArray(artifacts.removed_view_ids)
      ? artifacts.removed_view_ids.length
      : 0;
    const removedQueryIds = Array.isArray(artifacts.removed_query_ids)
      ? artifacts.removed_query_ids.length
      : 0;
    const removedBindingIds = Array.isArray(artifacts.removed_binding_ids)
      ? artifacts.removed_binding_ids.length
      : 0;
    const blockers = Array.isArray(details.blockers) ? details.blockers.length : 0;
    return [
      `transaction=${compactText(details.transaction_id, 80) ?? "unknown"}`,
      `stage=${compactText(details.stage, 40) ?? "unknown"}`,
      `view=${compactText(artifacts.view_id, 80) ?? "none"}`,
      `query=${compactText(artifacts.query_id, 80) ?? "none"}`,
      `bindings=${bindingIds}`,
      `removed_views=${removedViewIds}`,
      `removed_queries=${removedQueryIds}`,
      `removed_bindings=${removedBindingIds}`,
      `blockers=${blockers}`,
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
    toolCallId: redactToolCallId(result.toolCallId),
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
        toolCallId: redactToolCallId(event.toolCallId),
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
    toolCallId: redactToolCallId(event.toolCallId),
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

function progressSummary(facts: AuthoringDerivedFacts) {
  return {
    latestGoalKind: facts.latestGoal?.kind ?? null,
    latestGoalAccepted: facts.latestGoal?.accepted ?? null,
    activeGoalId: facts.latestGoal?.activeGoalId ?? null,
    pendingProposalId: facts.pendingProposal?.proposalId ?? null,
    pendingProposalBaseVersion: facts.pendingProposal?.baseVersion ?? null,
    draftHasChanges: facts.draft?.hasDraft ?? null,
    draftCanCompose: facts.draft?.canCompose ?? null,
    latestCheckStatus: facts.latestCheck?.status ?? null,
    approvalDecision: facts.approval?.decision ?? null,
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
  facts: AuthoringDerivedFacts;
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
    actionKind: null,
    activeTools: [...input.surface.activeTools],
    toolChoice: input.surface.toolChoice,
    contextFingerprint: input.contextFingerprint ?? null,
    progress: progressSummary(input.facts),
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

export function buildProviderPayloadLedgerEvent(input: {
  seq: number;
  runId: string;
  sessionId?: string | null;
  dashboardId?: string | null;
  turnId?: string | null;
  startedAtMs: number;
  surface: RuntimeToolSurface;
  profile: AuthoringCapabilityProfile;
  scope: AuthoringScope;
  facts: AuthoringDerivedFacts;
  contextFingerprint?: string | null;
  providerPayload: ProviderPayloadSummary;
}): AuthoringAgentLedgerEvent {
  return {
    ts: new Date().toISOString(),
    seq: input.seq,
    runId: input.runId,
    sessionId: input.sessionId ?? null,
    dashboardId: input.dashboardId ?? null,
    turnId: input.turnId ?? null,
    kind: "provider_payload",
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    surfaceMode: input.surface.mode,
    surfaceReason: input.surface.reason ?? null,
    profile: input.profile,
    scope: {
      kind: input.scope.kind,
      viewId: input.scope.kind === "focused" ? input.scope.viewId : null,
    },
    actionKind: null,
    activeTools: [...input.surface.activeTools],
    toolChoice: input.surface.toolChoice,
    contextFingerprint: input.contextFingerprint ?? null,
    progress: progressSummary(input.facts),
    providerPayload: input.providerPayload,
    errorSummary: null,
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
  facts: AuthoringDerivedFacts;
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
    actionKind: null,
    activeTools: [...input.surface.activeTools],
    toolChoice: input.surface.toolChoice,
    contextFingerprint: input.contextFingerprint ?? null,
    progress: progressSummary(input.facts),
  };
}
