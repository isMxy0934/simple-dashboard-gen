import "server-only";

import { AiTraceJsonlSink } from "./sinks/ai-trace-sink";
import { JsonlFileSink } from "./sinks/jsonl-file-sink";

export type ObservabilityLevel = "info" | "warn" | "error";
export type ObservabilityStatus = "active" | "completed" | "errored";

export interface ObservabilityEvent {
  type: string;
  sessionId: string;
  dashboardId: string | null;
  turnId: string | null;
  requestId: string;
  level: ObservabilityLevel;
  timestamp: string;
  payload?: unknown;
  status?: ObservabilityStatus;
  legacyScope?: string;
  legacyEvent?: string;
}

export interface LogSink {
  name: string;
  write(event: ObservabilityEvent): Promise<void>;
  flush?(): Promise<void>;
}

export class ObservabilityBus {
  private readonly sinks: LogSink[] = [];
  private readonly queues = new Map<string, Promise<void>>();

  register(sink: LogSink): void {
    this.sinks.push(sink);
  }

  emit(event: ObservabilityEvent): Promise<void> {
    const key = event.sessionId || "__global__";
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await Promise.all(
          this.sinks.map(async (sink) => {
            try {
              await sink.write(event);
            } catch {
              // Observability must never break the request path. Sink failures
              // are intentionally isolated; a separate health check can report
              // broken sinks without throwing back into application code.
            }
          }),
        );
      });

    this.queues.set(key, next);
    void next.finally(() => {
      if (this.queues.get(key) === next) {
        this.queues.delete(key);
      }
    });
    return next;
  }

  async flushAll(): Promise<void> {
    await Promise.all(this.queues.values());
    await Promise.all(this.sinks.map((sink) => sink.flush?.() ?? Promise.resolve()));
  }
}

export function sanitizeObservabilityPayload(payload: unknown): unknown {
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
      return `${value.slice(0, 4000)}...`;
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

export const observability = new ObservabilityBus();
observability.register(new JsonlFileSink());
observability.register(new AiTraceJsonlSink());
