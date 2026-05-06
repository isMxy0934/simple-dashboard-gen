import "server-only";

import { readFile } from "fs/promises";
import type { TraceEvent } from "./types";
import type { AuthoringAgentLedgerEvent } from "@/ai/authoring/agent/ledger";
import {
  resolveAgentLedgerFilePath,
  resolveTraceFilePath,
} from "./session-log-paths";

export interface AuthoringTraceSummaryEvent {
  ts: string;
  seq: number;
  turnId: string | null;
  turnIndex: number | null;
  turnLabel: string | null;
  elapsedMs: number | null;
  scope: string;
  event: string;
  piEventType?: string | null;
  runId?: string | null;
  surfaceMode?: string | null;
  surfaceReason?: string | null;
  profile?: string | null;
  providerPayload?: {
    provider?: string;
    modelId?: string;
    api?: string;
    thinkingLevel?: string;
    inputCount?: number | null;
    messageCount?: number | null;
    toolCount?: number | null;
    storeFalse?: boolean | null;
    observations?: Array<{ kind: string; path: string }>;
  } | null;
  durationMs?: number | null;
  contextFingerprint?: string | null;
  stepNumber?: number | null;
  mode?: string | null;
  actionKind?: string | null;
  toolName?: string | null;
  activeTools?: string[];
  toolChoice?: unknown;
  toolCalls?: Array<{ toolName: string }>;
  toolResults?: Array<{ toolName: string; hasError: boolean }>;
  activeGoalId?: string | null;
  activeGoalStatus?: string | null;
  context?: {
    datasourcesLoaded?: boolean;
    schemaLoadedFor?: { datasourceId?: string | null; table?: string | null } | null;
  } | null;
  artifacts?: {
    query?: boolean;
    view?: boolean;
    binding?: boolean;
    layout?: boolean;
    runtimeCheck?: string | null;
    patchComposed?: boolean;
    patchStale?: boolean;
  } | null;
  failureReason?: string | null;
  summary: string;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactText(value: unknown, limit = 120): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const compacted = value.trim().replace(/\s+/g, " ");
  if (!compacted) {
    return null;
  }
  return compacted.length > limit ? `${compacted.slice(0, limit)}…` : compacted;
}

function extractLatestUserTextFromPayload(payload: Record<string, unknown>): string | null {
  const direct = compactText(payload.latest_user_text);
  if (direct) {
    return direct;
  }

  const outline = Array.isArray(payload.messages_outline)
    ? payload.messages_outline
    : [];
  for (const item of [...outline].reverse()) {
    const record = asRecord(item);
    if (record.role !== "user" || !Array.isArray(record.parts)) {
      continue;
    }
    const textPart = record.parts.find(
      (part) => typeof part === "string" && part.startsWith("text:"),
    );
    const text = compactText(
      typeof textPart === "string" ? textPart.slice("text:".length) : null,
    );
    if (text) {
      return text;
    }
  }
  return null;
}

function summarizeToolChoice(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  if (typeof record.toolName === "string") {
    return record.toolName;
  }
  return null;
}

function summarizeToolCalls(value: unknown): Array<{ toolName: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const calls = value
    .map((item) => asRecord(item).toolName)
    .filter((toolName): toolName is string => typeof toolName === "string")
    .map((toolName) => ({ toolName }));
  return calls.length ? calls : undefined;
}

function summarizeToolResults(
  value: unknown,
): Array<{ toolName: string; hasError: boolean }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const results = value.flatMap((item) => {
    const record = asRecord(item);
    return typeof record.toolName === "string"
      ? [{ toolName: record.toolName, hasError: record.hasError === true }]
      : [];
  });
  return results.length ? results : undefined;
}

function summarizePayload(event: string, payload: Record<string, unknown>) {
  const mode = typeof payload.mode === "string" ? payload.mode : null;
  const actionKind = typeof payload.actionKind === "string" ? payload.actionKind : null;
  const toolName = typeof payload.toolName === "string" ? payload.toolName : null;
  const failureReason = typeof payload.reason === "string"
    ? payload.reason
    : typeof payload.message === "string"
      ? payload.message
      : null;
  const latestUserText = extractLatestUserTextFromPayload(payload);
  if (event === "request_received") {
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: latestUserText
        ? `User request: ${latestUserText}`
        : "User request received",
    };
  }
  if (event === "request_start") {
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: latestUserText
        ? `Request context built for: ${latestUserText}`
        : "Request context built",
    };
  }
  if (event === "turn_start") {
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: `Turn started in ${mode ?? "agent"} mode`,
    };
  }
  if (event === "prepare-step") {
    const workflow = asRecord(payload.workflow);
    const action = asRecord(workflow.action);
    const stepToolName = typeof action.tool === "string" ? action.tool : null;
    const activeTools = Array.isArray(payload.activeTools)
      ? payload.activeTools.filter((tool): tool is string => typeof tool === "string")
      : [];
    const choice = summarizeToolChoice(payload.toolChoice);
    return {
      mode,
      actionKind: typeof action.kind === "string" ? action.kind : null,
      toolName: stepToolName,
      failureReason,
      summary: stepToolName
        ? `Prepared ${action.kind ?? "workflow"} with ${stepToolName}`
        : `Prepared ${mode ?? "agent"} step (${activeTools.length} tools, choice ${choice ?? "auto"})`,
    };
  }
  if (event === "workflow_decision" || event === "inspect_decision") {
    const activeTools = Array.isArray(payload.activeTools)
      ? payload.activeTools.filter((tool): tool is string => typeof tool === "string")
      : [];
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: toolName
        ? `${event}: ${actionKind ?? "action"} -> ${toolName}`
        : `${event}: ${actionKind ?? mode ?? "ready"} (${activeTools.length} tools)`,
    };
  }
  if (event === "goal_declared") {
    return {
      mode,
      actionKind: typeof payload.declaredIntentKind === "string"
        ? payload.declaredIntentKind
        : null,
      toolName,
      failureReason,
      summary: `Goal declared: ${String(payload.declaredIntentKind ?? "unknown")}`,
    };
  }
  if (event === "tool_protocol_error" || event === "forced_tool_missing_result") {
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: `${event}: ${failureReason ?? "tool protocol failure"}`,
    };
  }
  if (event === "agent_step_finish") {
    const calls = summarizeToolCalls(payload.toolCalls);
    const results = summarizeToolResults(payload.toolResults);
    const called = calls?.map((call) => call.toolName).join(", ");
    const failed = results?.filter((result) => result.hasError).map((result) => result.toolName);
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: called
        ? `Step finished after tool call: ${called}${failed?.length ? ` (failed: ${failed.join(", ")})` : ""}`
        : "Step finished without tool call",
    };
  }
  if (event === "turn_finish") {
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: `Turn finished in ${mode ?? "agent"} mode`,
    };
  }
  if (event === "turn_error") {
    return {
      mode,
      actionKind,
      toolName,
      failureReason,
      summary: `Turn failed: ${failureReason ?? "unknown error"}`,
    };
  }
  return {
    mode,
    actionKind,
    toolName,
    failureReason,
    summary: event,
  };
}

function readContextSummary(value: unknown): AuthoringTraceSummaryEvent["context"] {
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return null;
  }
  const schema = asRecord(record.schemaLoadedFor);
  return {
    ...(typeof record.datasourcesLoaded === "boolean"
      ? { datasourcesLoaded: record.datasourcesLoaded }
      : {}),
    schemaLoadedFor: Object.keys(schema).length
      ? {
          datasourceId: typeof schema.datasourceId === "string"
            ? schema.datasourceId
            : null,
          table: typeof schema.table === "string" ? schema.table : null,
        }
      : null,
  };
}

function readArtifactSummary(value: unknown): AuthoringTraceSummaryEvent["artifacts"] {
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return null;
  }
  return {
    query: typeof record.query === "boolean" ? record.query : undefined,
    view: typeof record.view === "boolean" ? record.view : undefined,
    binding: typeof record.binding === "boolean" ? record.binding : undefined,
    layout: typeof record.layout === "boolean" ? record.layout : undefined,
    runtimeCheck: typeof record.runtimeCheck === "string"
      ? record.runtimeCheck
      : null,
    patchComposed: typeof record.patchComposed === "boolean"
      ? record.patchComposed
      : undefined,
    patchStale: typeof record.patchStale === "boolean"
      ? record.patchStale
      : undefined,
  };
}

function summarizeTraceEvent(
  event: TraceEvent,
  turnInfo: Map<string, { index: number; label: string | null; startedAtMs: number }>,
): AuthoringTraceSummaryEvent {
  const payload = asRecord(event.payload);
  const payloadSummary = summarizePayload(event.event, payload);
  const info = event.turnId ? turnInfo.get(event.turnId) : undefined;
  const tsMs = Date.parse(event.ts);
  return {
    ts: event.ts,
    seq: event.seq,
    turnId: event.turnId ?? null,
    turnIndex: info?.index ?? null,
    turnLabel: info?.label ?? null,
    elapsedMs: info && Number.isFinite(tsMs) ? Math.max(0, tsMs - info.startedAtMs) : null,
    scope: event.scope,
    event: event.event,
    stepNumber: typeof payload.stepNumber === "number" ? payload.stepNumber : null,
    mode: payloadSummary.mode,
    actionKind: payloadSummary.actionKind,
    toolName: payloadSummary.toolName,
    activeTools: Array.isArray(payload.activeTools)
      ? payload.activeTools.filter((tool): tool is string => typeof tool === "string")
      : undefined,
    toolChoice: payload.toolChoice,
    toolCalls: summarizeToolCalls(payload.toolCalls),
    toolResults: summarizeToolResults(payload.toolResults),
    activeGoalId: typeof payload.activeGoalId === "string" ? payload.activeGoalId : null,
    activeGoalStatus: typeof payload.activeGoalStatus === "string" ? payload.activeGoalStatus : null,
    context: readContextSummary(payload.context),
    artifacts: readArtifactSummary(payload.artifacts),
    failureReason: payloadSummary.failureReason,
    summary: payloadSummary.summary,
  };
}

function summarizeLedgerEvent(
  event: AuthoringAgentLedgerEvent,
  turnInfo: Map<string, { index: number; label: string | null; startedAtMs: number }>,
): AuthoringTraceSummaryEvent {
  const info = event.turnId ? turnInfo.get(event.turnId) : undefined;
  const tsMs = Date.parse(event.ts);
  const firstTool = event.toolCall?.toolName ?? event.toolResults?.[0]?.toolName ?? null;
  const failureReason = event.errorSummary ?? null;
  const summary =
    event.kind === "provider_payload"
      ? `Provider payload observed: ${event.providerPayload?.provider ?? "unknown"}`
      : event.piEventType
        ? `Pi event: ${event.piEventType}`
        : event.kind;

  return {
    ts: event.ts,
    seq: event.seq,
    turnId: event.turnId ?? null,
    turnIndex: info?.index ?? null,
    turnLabel: info?.label ?? null,
    elapsedMs: info && Number.isFinite(tsMs) ? Math.max(0, tsMs - info.startedAtMs) : null,
    scope: "authoring-agent-ledger",
    event: event.kind,
    piEventType: event.piEventType ?? null,
    runId: event.runId,
    surfaceMode: event.surfaceMode,
    surfaceReason: event.surfaceReason ?? null,
    profile: event.profile,
    providerPayload: event.providerPayload ?? null,
    durationMs: event.durationMs,
    contextFingerprint: event.contextFingerprint ?? null,
    mode: event.surfaceMode,
    actionKind: event.actionKind ?? null,
    toolName: firstTool,
    activeTools: event.activeTools,
    toolChoice: event.toolChoice,
    toolCalls: event.toolCall ? [{ toolName: event.toolCall.toolName }] : undefined,
    toolResults: event.toolResults?.map((result) => ({
      toolName: result.toolName,
      hasError: result.isError,
    })),
    activeGoalId: event.workflow.activeGoalId,
    activeGoalStatus: event.workflow.activeGoalStatus,
    context: null,
    artifacts: null,
    failureReason,
    summary,
  };
}

function buildTurnInfo(events: TraceEvent[]) {
  const turnInfo = new Map<string, { index: number; label: string | null; startedAtMs: number }>();
  for (const event of events) {
    if (!event.turnId) {
      continue;
    }
    const startedAtMs = Date.parse(event.ts);
    const existing = turnInfo.get(event.turnId);
    const label = extractLatestUserTextFromPayload(asRecord(event.payload));
    if (!existing) {
      turnInfo.set(event.turnId, {
        index: turnInfo.size + 1,
        label,
        startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0,
      });
      continue;
    }
    if (!existing.label && label) {
      existing.label = label;
    }
  }
  return turnInfo;
}

function summarySort(
  a: AuthoringTraceSummaryEvent,
  b: AuthoringTraceSummaryEvent,
) {
  const tsDiff = Date.parse(a.ts) - Date.parse(b.ts);
  return tsDiff === 0 ? a.seq - b.seq : tsDiff;
}

function summaryEventKey(event: AuthoringTraceSummaryEvent): string {
  return `${event.ts}:${event.seq}:${event.scope}:${event.event}`;
}

function isRetainedSummaryEvent(event: AuthoringTraceSummaryEvent): boolean {
  return (
    event.event === "provider_payload" ||
    event.event === "surface" ||
    event.event === "request_received" ||
    event.event === "request_start" ||
    event.event === "turn_start" ||
    event.event === "turn_finish" ||
    event.event === "turn_error" ||
    event.event === "prepare-step" ||
    event.event === "inspect_decision" ||
    event.event === "workflow_decision" ||
    event.event === "tool_protocol_error" ||
    event.event === "forced_tool_missing_result" ||
    event.piEventType === "tool_execution_start" ||
    event.piEventType === "tool_execution_end" ||
    event.piEventType === "agent_end"
  );
}

function limitTraceSummaryEvents(
  events: AuthoringTraceSummaryEvent[],
  limit: number,
): AuthoringTraceSummaryEvent[] {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  if (events.length <= boundedLimit) {
    return events;
  }

  const tailStart = Math.max(0, events.length - boundedLimit);
  const tail = events.slice(tailStart);
  const tailKeys = new Set(tail.map(summaryEventKey));
  const retained = events
    .slice(0, tailStart)
    .filter((event) => isRetainedSummaryEvent(event) && !tailKeys.has(summaryEventKey(event)));

  if (retained.length >= boundedLimit) {
    return retained.slice(-boundedLimit).sort(summarySort);
  }

  return [
    ...retained,
    ...tail.slice(-(boundedLimit - retained.length)),
  ].sort(summarySort);
}

export async function readAuthoringTraceSummary(input: {
  dashboardId?: string | null;
  sessionId: string;
  limit?: number;
}): Promise<AuthoringTraceSummaryEvent[]> {
  try {
    const traceEvents = await readTraceEvents(input);
    const ledgerEvents = await readLedgerEvents(input);
    const turnInfo = buildTurnInfo(traceEvents);
    const summarized = [
      ...traceEvents.map((event) => summarizeTraceEvent(event, turnInfo)),
      ...ledgerEvents.map((event) => summarizeLedgerEvent(event, turnInfo)),
    ].sort(summarySort);
    return limitTraceSummaryEvents(summarized, input.limit ?? 200);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

async function readTraceEvents(input: {
  dashboardId?: string | null;
  sessionId: string;
}): Promise<TraceEvent[]> {
  try {
    const raw = await readFile(resolveTraceFilePath(input), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceEvent);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

async function readLedgerEvents(input: {
  dashboardId?: string | null;
  sessionId: string;
}): Promise<AuthoringAgentLedgerEvent[]> {
  try {
    const raw = await readFile(resolveAgentLedgerFilePath(input), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuthoringAgentLedgerEvent);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}
