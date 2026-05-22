import "server-only";

import { appendFile, mkdir } from "fs/promises";
import type { LogSink, ObservabilityEvent } from "../observability";
import {
  resolveAiTraceFilePath,
  resolveSessionLogDirPath,
} from "../session-log-manifest";
import { toTraceEvent } from "./jsonl-file-sink";

declare global {
  var __observabilityTraceSequences: Map<string, number> | undefined;
}

export const AI_TRACE_EVENT_WHITELIST = new Set([
  "agent.turn.start",
  "agent.turn.end",
  "agent.turn.error",
  "agent.step.prepare",
  "agent.step.finish",
  "agent.inspect.decision",
  "agent.goal.declared",
  "agent.tool.protocol_error",
  "stream.request.start",
  "stream.ui.step_finish",
  "stream.ui.finish",
] as const);

function getTraceSequences() {
  if (!globalThis.__observabilityTraceSequences) {
    globalThis.__observabilityTraceSequences = new Map();
  }
  return globalThis.__observabilityTraceSequences;
}

function nextTraceSeq(sessionKey: string) {
  const sequences = getTraceSequences();
  const next = (sequences.get(sessionKey) ?? 0) + 1;
  sequences.set(sessionKey, next);
  return next;
}

export class AiTraceJsonlSink implements LogSink {
  readonly name = "ai-trace-jsonl";

  async write(event: ObservabilityEvent): Promise<void> {
    if (!AI_TRACE_EVENT_WHITELIST.has(event.type as never)) {
      return;
    }

    const tracePathInput = {
      dashboardId: event.dashboardId,
      sessionId: event.sessionId,
    };
    await mkdir(resolveSessionLogDirPath(tracePathInput), { recursive: true });
    await appendFile(
      resolveAiTraceFilePath(tracePathInput),
      `${JSON.stringify(toTraceEvent(event, nextTraceSeq(`${event.sessionId}:ai`)))}\n`,
      "utf8",
    );
  }
}

export {
  AI_TRACE_EVENT_WHITELIST as AI_TRACE_EVENT_ALLOWLIST,
};
