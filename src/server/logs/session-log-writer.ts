import "server-only";

import { appendFile, mkdir } from "fs/promises";
import type { TraceEvent } from "./types";
import {
  appendTraceManifestEntry,
  resolveAiTraceFileManifestRef,
  resolveAiTraceFilePath,
  resolveTraceFileManifestRef,
  resolveTraceFilePath,
  resolveSessionLogDirPath,
} from "./session-log-manifest";

declare global {
  var __mainAgentTraceWriteQueues:
    | Map<string, Promise<void>>
    | undefined;
  var __mainAgentTraceSequences:
    | Map<string, number>
    | undefined;
}

const AI_TRACE_EVENT_WHITELIST = new Set([
  "authoring-chat-flow.request_start",
  "authoring-chat-flow.ui_stream_step_finish",
  "authoring-chat-flow.ui_stream_finish",
  "authoring-agent.turn_start",
  "authoring-agent.prepare-step",
  "authoring-agent.inspect_decision",
  "authoring-agent.goal_declared",
  "authoring-agent.tool_protocol_error",
  "authoring-agent.agent_step_finish",
  "authoring-agent.turn_finish",
  "authoring-agent.turn_error",
]);

function getTraceWriteQueues() {
  if (!globalThis.__mainAgentTraceWriteQueues) {
    globalThis.__mainAgentTraceWriteQueues = new Map();
  }

  return globalThis.__mainAgentTraceWriteQueues;
}

function getTraceSequences() {
  if (!globalThis.__mainAgentTraceSequences) {
    globalThis.__mainAgentTraceSequences = new Map();
  }

  return globalThis.__mainAgentTraceSequences;
}

function nextTraceSeq(sessionKey: string) {
  const sequences = getTraceSequences();
  const next = (sequences.get(sessionKey) ?? 0) + 1;
  sequences.set(sessionKey, next);
  return next;
}

function sanitizePayload(payload: unknown): unknown {
  if (payload === undefined) {
    return null;
  }

  const seen = new WeakSet<object>();
  const json = JSON.stringify(payload, (_key, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "string" && value.length > 4000) {
      return `${value.slice(0, 4000)}…`;
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }

    return value;
  });

  if (json === undefined) {
    return null;
  }

  try {
    return JSON.parse(json);
  } catch {
    return {
      serialization_error: true,
      payload_type: typeof payload,
    };
  }
}

export async function writeSessionTraceEvent(input: {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
  scope: string;
  event: string;
  payload?: unknown;
  status?: "active" | "completed" | "errored";
}) {
  const queues = getTraceWriteQueues();
  const current = queues.get(input.sessionId) ?? Promise.resolve();
  const next = current
    .catch(() => undefined)
    .then(async () => {
      const ts = new Date().toISOString();
      const sessionEvent: TraceEvent = {
        ts,
        seq: nextTraceSeq(`${input.sessionId}:session`),
        sessionId: input.sessionId,
        dashboardId: input.dashboardId ?? null,
        turnId: input.turnId ?? null,
        scope: input.scope,
        event: input.event,
        payload: sanitizePayload(input.payload),
      };
      const eventKey = `${input.scope}.${input.event}`;
      const shouldWriteAiTrace = AI_TRACE_EVENT_WHITELIST.has(eventKey);
      const tracePathInput = {
        dashboardId: input.dashboardId ?? null,
        sessionId: input.sessionId,
      };

      try {
        await mkdir(resolveSessionLogDirPath(tracePathInput), { recursive: true });
        await appendFile(
          resolveTraceFilePath(tracePathInput),
          `${JSON.stringify(sessionEvent)}\n`,
          "utf8",
        );
        if (shouldWriteAiTrace) {
          const aiEvent: TraceEvent = {
            ...sessionEvent,
            seq: nextTraceSeq(`${input.sessionId}:ai`),
          };
          await appendFile(
            resolveAiTraceFilePath(tracePathInput),
            `${JSON.stringify(aiEvent)}\n`,
            "utf8",
          );
        }
        await appendTraceManifestEntry({
          sessionId: input.sessionId,
          dashboardId: input.dashboardId ?? null,
          startedAt: ts,
          lastEventAt: ts,
          status: input.status ?? "active",
          traceFile: resolveTraceFileManifestRef(tracePathInput),
          aiTraceFile: resolveAiTraceFileManifestRef(tracePathInput),
        });
      } catch (error) {
        // Tracing must never break the request flow.
        console.error("[trace-writer] failed", {
          sessionId: input.sessionId,
          scope: input.scope,
          event: input.event,
          error,
        });
      }
    });

  queues.set(input.sessionId, next);
  await next;
}
