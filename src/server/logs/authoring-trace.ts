import "server-only";

import { randomUUID } from "crypto";
import {
  observability,
  sanitizeObservabilityPayload,
  type ObservabilityBus,
  type ObservabilityEvent,
  type ObservabilityLevel,
  type ObservabilityStatus,
} from "./observability";

const TRACE_TYPE_MAP: Record<string, string> = {
  "authoring-chat.request_received": "stream.request.received",
  "authoring-chat.resume_stream_hit": "stream.resume.hit",
  "authoring-chat-flow.request_start": "stream.request.start",
  "authoring-chat-flow.ui_stream_step_finish": "stream.ui.step_finish",
  "authoring-chat-flow.ui_stream_finish": "stream.ui.finish",
  "authoring-chat-flow.stream_lease_release_error": "stream.lease.release_error",
  "authoring-chat-flow.stream_reserve_rejected_active_session": "stream.reserve.rejected",
  "authoring-chat-flow.stream_reserve_lease_error": "stream.reserve.error",
  "authoring-chat-flow.stream_reserve_rejected_active_lease": "stream.reserve.rejected",
  "authoring-chat-flow.stream_register_rejected_active_session": "stream.register.rejected",
  "authoring-chat-flow.stream_registered": "stream.registered",
  "authoring-chat-flow.stream_source_ended": "stream.source.ended",
  "authoring-chat-flow.stream_pump_complete": "stream.pump.complete",
  "authoring-chat-flow.stream_pump_error": "stream.pump.error",
  "authoring-chat-flow.stream_unregistered": "stream.unregistered",
  "authoring-agent.turn_start": "agent.turn.start",
  "authoring-agent.turn_finish": "agent.turn.end",
  "authoring-agent.turn_error": "agent.turn.error",
  "authoring-agent.provider_payload": "agent.provider.payload",
  "authoring-agent.prepare-step": "agent.step.prepare",
  "authoring-agent.agent_step_finish": "agent.step.finish",
  "authoring-agent.inspect_decision": "agent.inspect.decision",
  "authoring-agent.goal_declared": "agent.goal.declared",
  "authoring-agent.tool_protocol_error": "agent.tool.protocol_error",
  "authoring-agent.tool_execution_end": "agent.tool.result",
};

function toEventType(scope: string, event: string): string {
  return TRACE_TYPE_MAP[`${scope}.${event}`] ?? `${scope}.${event}`.replaceAll("_", ".");
}

function defaultLevel(input: {
  type: string;
  event: string;
  status?: ObservabilityStatus;
  payload?: unknown;
}): ObservabilityLevel {
  if (input.status === "errored") {
    return "error";
  }
  if (
    input.type.includes(".error") ||
    input.event.includes("error") ||
    input.event.includes("rejected") ||
    (
      typeof input.payload === "object" &&
      input.payload !== null &&
      "hasError" in input.payload &&
      input.payload.hasError === true
    )
  ) {
    return "warn";
  }
  return "info";
}

export async function emitAuthoringTraceEvent(input: {
  bus?: ObservabilityBus;
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  requestId?: string | null;
  scope: string;
  event: string;
  payload?: unknown;
  status?: ObservabilityStatus;
  level?: ObservabilityLevel;
}): Promise<void> {
  const type = toEventType(input.scope, input.event);
  const payload = sanitizeObservabilityPayload(input.payload);
  const event: ObservabilityEvent = {
    type,
    level: input.level ?? defaultLevel({
      type,
      event: input.event,
      status: input.status,
      payload,
    }),
    sessionId: input.sessionId,
    dashboardId: input.dashboardId ?? null,
    turnId: input.turnId ?? null,
    requestId: input.requestId?.trim() || `req_${randomUUID()}`,
    timestamp: new Date().toISOString(),
    payload,
    status: input.status ?? "active",
    legacyScope: input.scope,
    legacyEvent: input.event,
  };

  await (input.bus ?? observability).emit(event);
}
