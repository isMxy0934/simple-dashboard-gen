import "server-only";

export type ObservabilityLevel = "debug" | "info" | "warn" | "error";

export interface ObservabilityEvent {
  type: string;
  level: ObservabilityLevel;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface LogSink {
  name: string;
  write(event: ObservabilityEvent): Promise<void>;
}

export class ObservabilityBus {
  private readonly sinks: LogSink[] = [];

  register(sink: LogSink): void {
    this.sinks.push(sink);
  }

  async emit(event: ObservabilityEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.write(event);
    }
  }
}

export const observability = new ObservabilityBus();
