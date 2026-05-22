import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { ObservabilityBus } = await import("../src/server/logs/observability.ts");

test("ObservabilityBus emits events to registered sinks", async () => {
  const events: unknown[] = [];
  const bus = new ObservabilityBus();
  bus.register({ name: "capture", write: async (event) => {
    events.push(event);
  } });

  await bus.emit({
    type: "auth.session.validated",
    level: "info",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: { workspaceId: "ws_default" },
  });

  assert.deepEqual(events, [{
    type: "auth.session.validated",
    level: "info",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: { workspaceId: "ws_default" },
  }]);
});
