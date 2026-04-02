import "server-only";

import { appendFile, mkdir } from "fs/promises";
import path from "path";
import type { TraceEvent } from "@/ai/shared/tracing";
import {
  appendTraceManifestEntry,
  resolveAiTraceFilePath,
  resolveTraceFilePath,
} from "./session-log-manifest";

declare global {
  var __dashboardAgentTraceWriteQueues:
    | Map<string, Promise<void>>
    | undefined;
  var __dashboardAgentTraceSequences:
    | Map<string, number>
    | undefined;
}

const SESSION_LOG_DIR = path.join(process.cwd(), "logs", "sessions");
const AI_TRACE_EVENT_WHITELIST = new Set([
  "agent-chat-flow.request_start",
  "dashboard-engine.route-decision",
  "dashboard-engine.conversation-reply",
  "dashboard-agent.prepare-step",
  "dashboard-agent.step-finished",
  "dashboard-agent.run-finished",
  "dashboard-agent.tool-call-start",
  "dashboard-agent.tool-call-finish",
]);

function getTraceWriteQueues() {
  if (!globalThis.__dashboardAgentTraceWriteQueues) {
    globalThis.__dashboardAgentTraceWriteQueues = new Map();
  }

  return globalThis.__dashboardAgentTraceWriteQueues;
}

function getTraceSequences() {
  if (!globalThis.__dashboardAgentTraceSequences) {
    globalThis.__dashboardAgentTraceSequences = new Map();
  }

  return globalThis.__dashboardAgentTraceSequences;
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

      try {
        await mkdir(SESSION_LOG_DIR, { recursive: true });
        await appendFile(
          resolveTraceFilePath(input.sessionId),
          `${JSON.stringify(sessionEvent)}\n`,
          "utf8",
        );
        if (shouldWriteAiTrace) {
          const aiEvent: TraceEvent = {
            ...sessionEvent,
            seq: nextTraceSeq(`${input.sessionId}:ai`),
          };
          await appendFile(
            resolveAiTraceFilePath(input.sessionId),
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
          traceFile: `${input.sessionId}.jsonl`,
          aiTraceFile: `${input.sessionId}.ai.jsonl`,
        });
      } catch {
        // Tracing must never break the request flow.
      }
    });

  queues.set(input.sessionId, next);
  await next;
}
