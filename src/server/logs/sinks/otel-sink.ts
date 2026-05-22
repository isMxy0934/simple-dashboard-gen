import "server-only";

import type { LogSink, ObservabilityEvent } from "../observability";
import type { FetchLike } from "./sentry-sink";

function toUnixNano(timestamp: string): string {
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis)) {
    return "0";
  }
  return String(BigInt(millis) * 1_000_000n);
}

function attribute(key: string, value: string | null) {
  return {
    key,
    value: { stringValue: value ?? "" },
  };
}

export class OpenTelemetrySink implements LogSink {
  readonly name = "otel";
  private readonly pending = new Set<Promise<void>>();
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;

  constructor(endpoint: string, options: { fetch?: FetchLike } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async write(event: ObservabilityEvent): Promise<void> {
    const request = this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                scope: { name: "simple-dashboard-gen" },
                logRecords: [
                  {
                    timeUnixNano: toUnixNano(event.timestamp),
                    severityText: event.level.toUpperCase(),
                    body: {
                      stringValue: JSON.stringify({
                        type: event.type,
                        status: event.status ?? null,
                        payload: event.payload ?? null,
                      }),
                    },
                    attributes: [
                      attribute("request.id", event.requestId),
                      attribute("session.id", event.sessionId),
                      attribute("dashboard.id", event.dashboardId),
                      attribute("turn.id", event.turnId),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`OpenTelemetry sink failed with ${response.status}`);
      }
    });

    this.track(request);
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }

  private track(request: Promise<void>): void {
    const isolated = request.catch(() => undefined);
    this.pending.add(isolated);
    void isolated.finally(() => {
      this.pending.delete(isolated);
    });
  }
}
