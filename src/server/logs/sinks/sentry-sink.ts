import "server-only";

import crypto from "node:crypto";
import type { LogSink, ObservabilityEvent } from "../observability";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export function resolveSentryStoreEndpoint(dsn: string): {
  endpoint: string;
  publicKey: string;
} {
  const parsed = new URL(dsn);
  const projectId = parsed.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);

  if (!projectId) {
    throw new Error("Sentry DSN must include a project id");
  }

  const endpoint = new URL(parsed.origin);
  endpoint.pathname = `/api/${projectId}/store/`;

  return {
    endpoint: endpoint.toString(),
    publicKey: decodeURIComponent(parsed.username),
  };
}

export class SentrySink implements LogSink {
  readonly name = "sentry";
  private readonly pending = new Set<Promise<void>>();
  private readonly endpoint: string;
  private readonly publicKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(dsn: string, options: { fetch?: FetchLike } = {}) {
    const resolved = resolveSentryStoreEndpoint(dsn);
    this.endpoint = resolved.endpoint;
    this.publicKey = resolved.publicKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async write(event: ObservabilityEvent): Promise<void> {
    if (event.level !== "error") {
      return;
    }

    const request = this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": [
          "Sentry sentry_version=7",
          `sentry_key=${this.publicKey}`,
          "sentry_client=simple-dashboard-gen/0.1",
        ].join(", "),
      },
      body: JSON.stringify({
        event_id: crypto.createHash("md5").update(event.requestId).digest("hex"),
        timestamp: event.timestamp,
        level: event.level,
        logger: "simple-dashboard-gen",
        message: event.type,
        tags: {
          dashboard_id: event.dashboardId,
          session_id: event.sessionId,
          turn_id: event.turnId,
        },
        extra: {
          request_id: event.requestId,
          payload: event.payload ?? null,
        },
      }),
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`Sentry sink failed with ${response.status}`);
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
