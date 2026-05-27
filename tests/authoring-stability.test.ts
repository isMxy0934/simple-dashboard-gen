import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { DashboardDocument, QueryDef } from "../src/contracts/dashboard.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { AuthoringToolGateError } = await import(
  "../src/ai/authoring/contracts/errors.ts"
);
const { validateStageQuerySqlCompatibility } = await import(
  "../src/ai/authoring/tools/stage-query-tool.ts"
);
const { buildViewCheckSnapshots } = await import(
  "../src/ai/authoring/tools/reliability.ts"
);
const { canonicalDashboardDocumentFingerprint } = await import(
  "../src/domain/dashboard/document-fingerprint.ts"
);
const {
  evictAuthoringAgentPoolEntry,
  registerAuthoringAgentPoolEntry,
} = await import("../src/server/authoring/agent-pool.ts");
const {
  resolveAuthoringSteerSessionId,
  steerAuthoringAgentTurn,
} = await import("../src/server/authoring/steer-service.ts");
const { buildAuthoringCompositeSessionId } = await import(
  "../src/shared/authoring/session-key.ts"
);
const { runEditingSessionCleanupBestEffort } = await import(
  "../src/server/dashboards/session-cleanup.ts"
);
const { createLatestWinsPromiseQueue } = await import(
  "../src/web/authoring/hooks/local-session-save-queue.ts"
);
const { createTemporaryDashboardViewIntentForRecipe } = await import(
  "../src/contracts/dashboard-view-intent.ts"
);

function rowQuery(): QueryDef {
  return {
    id: "q_sales",
    name: "Sales",
    datasource_id: "testing-db",
    sql_template:
      "select date_trunc('day', created_at) as day, sum(gmv) as metric_value from sales group by 1",
    params: [{ name: "region", type: "string" }],
    output: {
      kind: "rows",
      schema: [
        { name: "day", type: "date", nullable: false },
        { name: "metric_value", type: "number", nullable: false },
      ],
    },
  };
}

function dashboardDocument(): DashboardDocument {
  return {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "purple",
        default_view_style_id: "emphasis",
      },
      dashboard: { name: "Stability" },
      filters: [],
      views: [
        {
          id: "v_sales",
          title: "Sales",
          view_intent: createTemporaryDashboardViewIntentForRecipe({
            recipe_id: "echarts-bar",
            datasource_id: "testing-db",
            table: "sales",
            data_mode: "live",
            fields: {
              metric: {
                source_field: "gmv",
                aggregation: "sum",
              },
            },
          }),
          renderer: {
            kind: "echarts",
            recipe_id: "echarts-bar",
            option_template: {},
            slots: [],
          },
        },
      ],
      layout: {
        desktop: {
          cols: 12,
          row_height: 80,
          items: [{ view_id: "v_sales", x: 0, y: 0, w: 4, h: 3 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ view_id: "v_sales", x: 0, y: 0, w: 4, h: 3 }],
        },
      },
    },
    query_defs: [rowQuery()],
    bindings: [
      {
        id: "b_sales",
        view_id: "v_sales",
        slot_id: "value",
        mode: "live",
        query_id: "q_sales",
        param_mapping: {},
      },
    ],
  };
}

test("dashboard save/publish session cleanup is best effort", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const success = await runEditingSessionCleanupBestEffort({
      operation: "save",
      cleanup: async () => undefined,
    });
    assert.deepEqual(success, { session_cleaned: true });

    const failed = await runEditingSessionCleanupBestEffort({
      operation: "publish",
      cleanup: async () => {
        throw new Error("session revision changed");
      },
    });
    assert.equal(failed.session_cleaned, false);
    assert.equal(failed.cleanup_warning, "session revision changed");
  } finally {
    console.error = originalConsoleError;
  }
});

test("steer resolves raw chat session id to the composite pool session", () => {
  const compositeSessionId = buildAuthoringCompositeSessionId({
    workspaceId: "w1",
    userId: "u1",
    dashboardId: "d1",
    sessionId: "raw-session",
  });
  const steeredMessages: unknown[] = [];
  registerAuthoringAgentPoolEntry(compositeSessionId, {
    piAgent: {
      state: { isStreaming: true },
      steer: (message: unknown) => steeredMessages.push(message),
    },
  } as never);

  try {
    assert.equal(
      resolveAuthoringSteerSessionId({
        workspaceId: "w1",
        userId: "u1",
        dashboardId: "d1",
        chatSessionId: "raw-session",
      }),
      compositeSessionId,
    );

    const result = steerAuthoringAgentTurn({
      routeChatSessionId: "raw-session",
      workspaceId: "w1",
      userId: "u1",
      dashboardId: "d1",
      chatSessionId: "raw-session",
      message: "use the latest title",
    });
    assert.equal(result.ok, true);
    assert.equal(steeredMessages.length, 1);
  } finally {
    evictAuthoringAgentPoolEntry(compositeSessionId);
  }
});

test("steer returns 409 for an initialized but non-streaming pool session", () => {
  const compositeSessionId = buildAuthoringCompositeSessionId({
    workspaceId: "w1",
    userId: "u1",
    dashboardId: "d1",
    sessionId: "plain-session",
  });
  registerAuthoringAgentPoolEntry(compositeSessionId, {
    piAgent: {
      state: { isStreaming: false },
      steer: () => undefined,
    },
  } as never);

  try {
    const result = steerAuthoringAgentTurn({
      routeChatSessionId: "plain-session",
      workspaceId: "w1",
      userId: "u1",
      dashboardId: "d1",
      chatSessionId: "plain-session",
      message: "adjust this",
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.reason, "AGENT_NOT_STREAMING");
  } finally {
    evictAuthoringAgentPoolEntry(compositeSessionId);
  }
});

test("stageQuery rejects SQL that no longer satisfies QueryDef.output", () => {
  assert.doesNotThrow(() =>
    validateStageQuerySqlCompatibility(
      rowQuery(),
      "select day, sum(gmv) as metric_value from sales where region = {{ region }} group by day",
    ),
  );

  assert.throws(
    () =>
      validateStageQuerySqlCompatibility(
        rowQuery(),
        "select day, sum(gmv) as renamed_metric from sales group by day",
      ),
    (error) =>
      error instanceof AuthoringToolGateError &&
      error.code === "output_schema_mismatch",
  );

  assert.throws(
    () =>
      validateStageQuerySqlCompatibility(
        rowQuery(),
        "select * from sales where country = {{ country }}",
      ),
    (error) =>
      error instanceof AuthoringToolGateError &&
      error.code === "schema_mismatch",
  );
});

test("local autosave queue serializes saves and keeps the latest queued draft", async () => {
  let releaseFirst: () => void = () => undefined;
  let markFirstStarted: () => void = () => undefined;
  const saves: string[] = [];
  let active = 0;
  let maxActive = 0;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const queue = createLatestWinsPromiseQueue<string>(async (payload) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    saves.push(payload);
    if (payload === "first") {
      markFirstStarted();
      await firstBlocked;
    }
    active -= 1;
  });

  queue.enqueue("first");
  await firstStarted;
  queue.enqueue("second");
  queue.enqueue("third");
  releaseFirst();
  await queue.drain();

  assert.deepEqual(saves, ["first", "third"]);
  assert.equal(maxActive, 1);
});

test("server check snapshots are bound to the current document hash", () => {
  const document = dashboardDocument();
  const [snapshot] = buildViewCheckSnapshots({
    document,
    runtimeCheck: {
      status: "ok",
      reason: "ok",
      counts: { ok: 1, empty: 0, error: 0 },
      errors: [],
    },
    rendererChecks: {},
    visibleViewIds: ["v_sales"],
  });

  assert.equal(snapshot.source, "server");
  assert.equal(
    snapshot.document_hash,
    canonicalDashboardDocumentFingerprint(document),
  );
});
