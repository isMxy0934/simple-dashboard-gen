import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const observabilityModule = await import("../src/server/logs/observability.ts");
const { ObservabilityBus } = observabilityModule;
const { emitAuthoringTraceEvent } = await import("../src/server/logs/authoring-trace.ts");

test("ObservabilityBus emits events to registered sinks", async () => {
  const events: unknown[] = [];
  const bus = new ObservabilityBus();
  bus.register({ name: "capture", write: async (event) => {
    events.push(event);
  } });

  await bus.emit({
    type: "auth.session.validated",
    level: "info",
    sessionId: "sess_test",
    dashboardId: null,
    turnId: null,
    requestId: "req_test",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: { workspaceId: "ws_default" },
  });

  assert.deepEqual(events, [{
    type: "auth.session.validated",
    level: "info",
    sessionId: "sess_test",
    dashboardId: null,
    turnId: null,
    requestId: "req_test",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: { workspaceId: "ws_default" },
  }]);
});

test("ObservabilityBus isolates failing sinks", async () => {
  const events: unknown[] = [];
  const bus = new ObservabilityBus();
  bus.register({
    name: "broken",
    write: async () => {
      throw new Error("sink failed");
    },
  });
  bus.register({
    name: "capture",
    write: async (event) => {
      events.push(event);
    },
  });

  await bus.emit({
    type: "quota.warning",
    level: "warn",
    sessionId: "sess_test",
    dashboardId: null,
    turnId: null,
    requestId: "req_test",
    timestamp: "2026-05-22T00:00:01.000Z",
    payload: { current: 80, limit: 100 },
  });
  await bus.flushAll();

  assert.equal(events.length, 1);
  assert.equal((events[0] as { type: string }).type, "quota.warning");
});

test("emitAuthoringTraceEvent maps legacy authoring events to target event shape", async () => {
  const events: unknown[] = [];
  const bus = new ObservabilityBus();
  bus.register({
    name: "capture",
    write: async (event) => {
      events.push(event);
    },
  });

  await emitAuthoringTraceEvent({
    bus,
    sessionId: "sess_trace",
    dashboardId: "dash_1",
    turnId: "turn_1",
    requestId: "req_1",
    scope: "authoring-agent",
    event: "turn_start",
    payload: { mode: "agent" },
  });

  assert.deepEqual(events, [{
    type: "agent.turn.start",
    level: "info",
    sessionId: "sess_trace",
    dashboardId: "dash_1",
    turnId: "turn_1",
    requestId: "req_1",
    timestamp: (events[0] as { timestamp: string }).timestamp,
    payload: { mode: "agent" },
    status: "active",
    legacyScope: "authoring-agent",
    legacyEvent: "turn_start",
  }]);
});

test("createObservabilityBusFromEnv enables optional sentry and otel sinks from SDS env", async () => {
  assert.equal(typeof observabilityModule.createObservabilityBusFromEnv, "function");
  const createObservabilityBusFromEnv =
    observabilityModule.createObservabilityBusFromEnv as ((
      env: NodeJS.ProcessEnv,
      options: {
        fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
      },
    ) => InstanceType<typeof ObservabilityBus>);

  const requests: Array<{ url: string; body: string }> = [];
  const bus = createObservabilityBusFromEnv(
    {
      SDS_OBSERVABILITY_SINKS: "sentry,otel",
      SDS_SENTRY_DSN: "https://public@example.invalid/42",
      SDS_OTEL_ENDPOINT: "https://otel.example.invalid/v1/logs",
    },
    {
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          body: String(init?.body ?? ""),
        });
        return new Response(null, { status: 202 });
      },
    },
  );

  await bus.emit({
    type: "query.execution.error",
    level: "error",
    sessionId: "sess_test",
    dashboardId: "dash_test",
    turnId: null,
    requestId: "req_error",
    timestamp: "2026-05-22T00:00:02.000Z",
    payload: { code: "QUERY_FAILED" },
  });
  await bus.emit({
    type: "query.execution.start",
    level: "info",
    sessionId: "sess_test",
    dashboardId: "dash_test",
    turnId: null,
    requestId: "req_info",
    timestamp: "2026-05-22T00:00:03.000Z",
    payload: { queryId: "q_1" },
  });
  await bus.flushAll();

  assert.equal(requests.length, 3);
  assert.equal(
    requests.filter((request) => request.url.includes("example.invalid/api/42/store/")).length,
    1,
  );
  assert.equal(
    requests.filter((request) => request.url === "https://otel.example.invalid/v1/logs").length,
    2,
  );
  assert.match(requests.map((request) => request.body).join("\n"), /query\.execution\.error/);
});

test("createObservabilityBusFromEnv ignores invalid optional sink configuration", async () => {
  assert.equal(typeof observabilityModule.createObservabilityBusFromEnv, "function");
  const createObservabilityBusFromEnv =
    observabilityModule.createObservabilityBusFromEnv as ((
      env: NodeJS.ProcessEnv,
      options: {
        fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
      },
    ) => InstanceType<typeof ObservabilityBus>);

  const bus = createObservabilityBusFromEnv(
    {
      SDS_OBSERVABILITY_SINKS: "sentry,otel",
      SDS_SENTRY_DSN: "not a url",
      SDS_OTEL_ENDPOINT: "https://otel.example.invalid/v1/logs",
    },
    {
      fetch: async () => new Response(null, { status: 202 }),
    },
  );

  await bus.emit({
    type: "agent.turn.error",
    level: "error",
    sessionId: "sess_invalid_sink_config",
    dashboardId: null,
    turnId: null,
    requestId: "req_invalid_sink_config",
    timestamp: "2026-05-22T00:00:04.000Z",
    payload: null,
  });
  await bus.flushAll();
});
