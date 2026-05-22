import "server-only";

import type { LogSink, ObservabilityEvent } from "../observability";

export const AI_TRACE_EVENT_ALLOWLIST = [
  "agent.turn.started",
  "agent.turn.completed",
  "agent.turn.failed",
] as const;

export class AiTraceSink implements LogSink {
  readonly name = "ai-trace";

  async write(_event: ObservabilityEvent): Promise<void> {
    throw new Error("NOT_IMPLEMENTED: AiTraceSink.write");
  }
}
