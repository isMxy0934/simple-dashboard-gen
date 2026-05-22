import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { ObservabilityBus } = await import("../src/server/logs/observability.ts");
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
