import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { DashboardDocument } from "../src/contracts/dashboard.ts";
import type { AuthoringWorkingDraftOwnership } from "../src/ai/authoring/contracts/session.ts";
import type {
  ApprovalStateV2,
  ArtifactStatusV2,
  AuthoringGoalV2,
  ContextStatusV2,
  TurnIntentV2,
  WorkflowStateV2,
} from "../src/ai/authoring/v2/types.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const {
  applyWorkflowTransitionV2,
  decideNextActionV2,
  getActiveGoalV2,
  getChartCapabilitiesV2,
  inspectArtifactsV2,
  isWorkflowToolAllowedV2,
  prepareToolStepV2,
  reduceIntentToWorkflowStateV2,
} = await import("../src/ai/authoring/v2/index.ts");

function doc(input?: {
  queryIds?: string[];
  viewIds?: string[];
  bindingIds?: string[];
  layoutViewIds?: string[];
  bindingMode?: "live" | "mock";
  bindingQueryById?: Record<string, string>;
}): DashboardDocument {
  const viewIds = input?.viewIds ?? [];
  const queryIds = input?.queryIds ?? [];
  const bindingIds = input?.bindingIds ?? [];
  const layoutViewIds = input?.layoutViewIds ?? [];
  const bindingMode = input?.bindingMode ?? "live";
  const bindingQueryById = input?.bindingQueryById ?? {};
  return {
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: { name: "V2 Test" },
      filters: [],
      views: viewIds.map((id) => ({
        id,
        title: id,
        renderer: {
          kind: "echarts",
          option_template: { xAxis: { data: [] }, series: [{ data: [] }] },
          slots: [
            { id: "x", path: "xAxis.data", value_kind: "array", required: true },
            { id: "y", path: "series[0].data", value_kind: "array", required: true },
          ],
        },
      })),
      layout: {
        desktop: {
          cols: 12,
          row_height: 80,
          items: layoutViewIds.map((view_id, index) => ({
            view_id,
            x: 0,
            y: index * 4,
            w: 6,
            h: 4,
          })),
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: layoutViewIds.map((view_id, index) => ({
            view_id,
            x: 0,
            y: index * 4,
            w: 4,
            h: 4,
          })),
        },
      },
    },
    query_defs: queryIds.map((id) => ({
      id,
      name: id,
      datasource_id: "ds_sales",
      sql_template: "select week_start, gmv from sales",
      params: [],
      output: {
        kind: "rows",
        schema: [
          { name: "week_start", type: "date", nullable: false },
          { name: "gmv", type: "number", nullable: false },
        ],
      },
    })),
    bindings: bindingIds.flatMap((id) => {
      const view_id = viewIds[0] ?? "v_missing";
      const query_id = bindingQueryById[id] ?? queryIds[0] ?? "q_missing";
      return [
        {
          id: `${id}_x`,
          view_id,
          slot_id: "x",
          mode: bindingMode,
          ...(bindingMode === "mock"
            ? { mock_value: ["2026-W01"] }
            : { query_id, param_mapping: {}, result_selector: "rows[].week_start" }),
        },
        {
          id: `${id}_y`,
          view_id,
          slot_id: "y",
          mode: bindingMode,
          ...(bindingMode === "mock"
            ? { mock_value: [1] }
            : { query_id, param_mapping: {}, result_selector: "rows[].gmv" }),
        },
      ];
    }),
  };
}

function goal(overrides: Partial<AuthoringGoalV2> = {}): AuthoringGoalV2 {
  return {
    id: "goal_1",
    kind: "create_view",
    status: "active",
    summary: "Create GMV trend",
    dataMode: "live",
    chartPlan: { chartType: "line" },
    targetRefs: { datasourceId: "ds_sales", table: "sales" },
    blockers: [],
    createdFromTurnId: "turn_1",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    ...overrides,
  };
}

function context(overrides: Partial<ContextStatusV2> = {}): ContextStatusV2 {
  return {
    datasourcesLoaded: true,
    schemaLoadedFor: {
      datasourceId: "ds_sales",
      table: "sales",
      loadedAt: "2026-04-29T00:00:00.000Z",
    },
    chartSkillLoadedFor: {
      chartType: "line",
      referenceKey: "echarts-skills/line-timeseries",
      loadedAt: "2026-04-29T00:00:00.000Z",
    },
    dataFormatSkillLoadedFor: {
      shape: "time_series",
      referenceKey: "data-format-skills/time-series",
      loadedAt: "2026-04-29T00:00:00.000Z",
    },
    ...overrides,
  };
}

function workflow(activeGoal: AuthoringGoalV2 | null = goal()): WorkflowStateV2 {
  return activeGoal ? { goals: [activeGoal], activeGoalId: activeGoal.id } : { goals: [], activeGoalId: null };
}

function approval(overrides: Partial<ApprovalStateV2> = {}): ApprovalStateV2 {
  return { source: "none", userApproved: false, ...overrides };
}

function statusFor(input: {
  activeGoal?: AuthoringGoalV2 | null;
  candidate?: DashboardDocument;
  ownership?: AuthoringWorkingDraftOwnership;
  runtimeCheck?: ArtifactStatusV2["runtimeCheck"];
  pendingProposalId?: string;
  candidateFingerprint?: string;
  pendingProposalDraftFingerprint?: string;
}) {
  return inspectArtifactsV2({
    goal: input.activeGoal === undefined ? goal() : input.activeGoal,
    candidate: input.candidate ?? doc(),
    ownership: input.ownership,
    runtimeCheck: input.runtimeCheck,
    pendingProposalId: input.pendingProposalId,
    candidateFingerprint: input.candidateFingerprint,
    pendingProposalDraftFingerprint: input.pendingProposalDraftFingerprint,
  });
}

test("data-mode followup resumes the existing active goal", () => {
  const awaitingGoal = goal({
    status: "awaiting_user",
    dataMode: "undecided",
    blockers: [{ kind: "ambiguous_data_mode", message: "mock or live?" }],
  });
  const next = reduceIntentToWorkflowStateV2({
    state: workflow(awaitingGoal),
    intent: { kind: "set_data_mode", dataMode: "mock" },
    turnId: "turn_2",
    now: "2026-04-29T02:00:00.000Z",
  });

  assert.equal(getActiveGoalV2(next)?.id, awaitingGoal.id);
  assert.equal(getActiveGoalV2(next)?.status, "active");
  assert.equal(getActiveGoalV2(next)?.dataMode, "mock");
  assert.deepEqual(getActiveGoalV2(next)?.blockers, []);
});

test("authoring goals preserve undecided data mode until live or mock is explicit", () => {
  const createState = reduceIntentToWorkflowStateV2({
    state: workflow(null),
    intent: { kind: "create_view", goal: { chartType: "line" } },
    turnId: "turn_default_live",
    now: "2026-04-29T03:00:00.000Z",
  });
  assert.equal(getActiveGoalV2(createState)?.dataMode, "undecided");

  const reviseState = reduceIntentToWorkflowStateV2({
    state: workflow(null),
    intent: { kind: "revise_view", goal: { chartType: "bar", targetViewId: "view_1" } },
    turnId: "turn_revise_live",
    now: "2026-04-29T03:10:00.000Z",
  });
  assert.equal(getActiveGoalV2(reviseState)?.dataMode, "undecided");

  const dashboardState = reduceIntentToWorkflowStateV2({
    state: workflow(null),
    intent: {
      kind: "create_dashboard",
      goal: {
        summary: "Sales dashboard",
        views: [
          { summary: "GMV trend", chartType: "line" },
          { summary: "Top regions", chartType: "bar" },
        ],
      },
    },
    turnId: "turn_dashboard_live",
    now: "2026-04-29T03:20:00.000Z",
  });
  assert.deepEqual(dashboardState.goals.map((item) => item.dataMode), [
    "undecided",
    "undecided",
    "undecided",
  ]);

  const selectedDatasourceState = reduceIntentToWorkflowStateV2({
    state: workflow(null),
    intent: { kind: "create_view", goal: { chartType: "line" } },
    selectedDatasourceId: "ds_sales",
    turnId: "turn_selected_datasource",
    now: "2026-04-29T03:25:00.000Z",
  });
  assert.equal(getActiveGoalV2(selectedDatasourceState)?.dataMode, "live");

  const mockState = reduceIntentToWorkflowStateV2({
    state: workflow(null),
    intent: { kind: "create_view", goal: { chartType: "line", dataMode: "mock" } },
    turnId: "turn_mock",
    now: "2026-04-29T03:30:00.000Z",
  });
  assert.equal(getActiveGoalV2(mockState)?.dataMode, "mock");
});

test("skill references define chart capabilities used by v2 runtime", () => {
  const capabilities = getChartCapabilitiesV2();
  const line = capabilities.find((capability) => capability.chartType === "line");
  assert.equal(line?.referenceKey, "echarts-skills/line-timeseries");
  assert.equal(line?.dataShape, "time_series");
  assert.ok(line?.intentAliases.includes("折线图"));
});

test("create_dashboard intent creates a parent goal and active child goals", () => {
  const state = reduceIntentToWorkflowStateV2({
    state: workflow(null),
    intent: {
      kind: "create_dashboard",
      goal: {
        summary: "Sales dashboard",
        dataMode: "mock",
        views: [
          { summary: "GMV trend", chartType: "line" },
          { summary: "Top regions", chartType: "bar" },
        ],
      },
    },
    turnId: "turn_dashboard",
    now: "2026-04-29T04:00:00.000Z",
  });

  assert.equal(state.goals.length, 3);
  assert.equal(state.goals[0]?.kind, "create_dashboard");
  assert.deepEqual(state.goals[0]?.childGoalIds, [
    state.goals[1]?.id,
    state.goals[2]?.id,
  ]);
  assert.equal(getActiveGoalV2(state)?.summary, "GMV trend");
  assert.equal(getActiveGoalV2(state)?.parentGoalId, state.goals[0]?.id);
});

test("revise_view resolves target view before staging artifacts", () => {
  const reviseGoal = goal({
    kind: "revise_view",
    summary: "Change GMV trend to bar",
    chartPlan: { chartType: "bar" },
    targetRefs: { datasourceId: "ds_sales", table: "sales" },
  });
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "revise_view", goal: { chartType: "bar", targetViewTitle: "GMV trend" } },
      workflowState: workflow(reviseGoal),
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: reviseGoal }),
      approvalState: approval(),
    }),
    { kind: "inspect_view", tool: "getView" },
  );

  const resolved = applyWorkflowTransitionV2({
    state: workflow(reviseGoal),
    action: { kind: "inspect_view", tool: "getView" },
    toolExecution: {
      status: "succeeded",
      output: {
        match_status: "exact",
        view: {
          view: { id: "v_gmv" },
          query_ids: ["q_gmv"],
          bindings: [{ binding: { id: "b_gmv_x" } }, { binding: { id: "b_gmv_y" } }],
        },
      },
    },
  });
  assert.equal(getActiveGoalV2(resolved)?.targetRefs.viewId, "v_gmv");
  assert.equal(getActiveGoalV2(resolved)?.targetRefs.queryId, "q_gmv");
  assert.deepEqual(getActiveGoalV2(resolved)?.targetRefs.bindingIds, [
    "b_gmv_x",
    "b_gmv_y",
  ]);
});

test("create_view_live progresses through context, query, layout, and check failure gates", () => {
  const activeGoal = goal();
  const intent: TurnIntentV2 = { kind: "create_view", goal: { dataMode: "live" } };

  assert.deepEqual(
    decideNextActionV2({
      intent,
      workflowState: workflow(activeGoal),
      contextStatus: context({ schemaLoadedFor: undefined }),
      artifactStatus: statusFor({ activeGoal }),
      approvalState: approval(),
    }),
    { kind: "prepare_query_context", tool: "getSchemaByDatasource" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent,
      workflowState: workflow(activeGoal),
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal }),
      approvalState: approval(),
    }),
    { kind: "stage_query", tool: "upsertQuery" },
  );

  const completeWithoutLayout = statusFor({
    activeGoal: goal({
      targetRefs: {
        datasourceId: "ds_sales",
        table: "sales",
        queryId: "q1",
        viewId: "v1",
        bindingIds: ["b1_x", "b1_y"],
      },
    }),
    candidate: doc({ queryIds: ["q1"], viewIds: ["v1"], bindingIds: ["b1"] }),
  });
  assert.deepEqual(
    decideNextActionV2({
      intent,
      workflowState: workflow(goal({ targetRefs: { datasourceId: "ds_sales", table: "sales", queryId: "q1", viewId: "v1", bindingIds: ["b1_x", "b1_y"] } })),
      contextStatus: context(),
      artifactStatus: completeWithoutLayout,
      approvalState: approval(),
    }),
    { kind: "stage_layout", tool: "upsertLayout" },
  );

  const failedCheck = statusFor({
    activeGoal: goal({
      targetRefs: {
        datasourceId: "ds_sales",
        table: "sales",
        queryId: "q1",
        viewId: "v1",
        bindingIds: ["b1_x", "b1_y"],
      },
    }),
    candidate: doc({ queryIds: ["q1"], viewIds: ["v1"], bindingIds: ["b1"], layoutViewIds: ["v1"] }),
    runtimeCheck: {
      required: true,
      status: "failed",
      errors: [{ code: "runtime", message: "SQL failed" }],
    },
  });
  assert.deepEqual(
    decideNextActionV2({
      intent,
      workflowState: workflow(goal({ targetRefs: { datasourceId: "ds_sales", table: "sales", queryId: "q1", viewId: "v1", bindingIds: ["b1_x", "b1_y"] } })),
      contextStatus: context(),
      artifactStatus: failedCheck,
      approvalState: approval(),
    }),
    {
      kind: "block_goal",
      blocker: "check_failed",
      reason: "SQL failed",
    },
  );
});

test("missing and unsupported chart types do not fallback to legacy workflow", () => {
  const missingChart = goal({ chartPlan: {}, dataMode: "live" });
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(missingChart),
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: missingChart }),
      approvalState: approval(),
    }),
    {
      kind: "ask_user",
      blocker: "missing_chart_type",
      question: "你想创建或修改成哪一种图表？",
    },
  );

  const unsupported = goal({ chartPlan: { chartType: "pie" }, dataMode: "mock" });
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "mock", chartType: "pie" } },
      workflowState: workflow(unsupported),
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: unsupported }),
      approvalState: approval(),
    }),
    {
      kind: "block_goal",
      blocker: "unsupported_goal",
      reason:
        "Unsupported chart type: pie.",
    },
  );
});

test("create_view_mock does not require query and blocks data mode mismatch", () => {
  const mockGoal = goal({ dataMode: "mock" });
  const noView = statusFor({ activeGoal: mockGoal });
  assert.equal(noView.query.required, false);
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "mock" } },
      workflowState: workflow(mockGoal),
      contextStatus: context(),
      artifactStatus: noView,
      approvalState: approval(),
    }),
    { kind: "stage_view", tool: "upsertView" },
  );

  const mismatch = statusFor({
    activeGoal: goal({ dataMode: "mock", targetRefs: { viewId: "v1", bindingIds: ["b1_x", "b1_y"] } }),
    candidate: doc({ queryIds: ["q1"], viewIds: ["v1"], bindingIds: ["b1"] }),
  });
  assert.equal(mismatch.dataModeConsistent, false);
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "mock" } },
      workflowState: workflow(goal({ dataMode: "mock" })),
      contextStatus: context(),
      artifactStatus: mismatch,
      approvalState: approval(),
    }),
    {
      kind: "block_goal",
      blocker: "data_mode_mismatch",
      reason:
        "The staged artifacts do not match the active goal dataMode. Stop before check/compose and repair or restart this draft.",
    },
  );
});

test("goal-scoped ownership prevents old dashboard artifacts from satisfying current goal", () => {
  const activeGoal = goal();
  const existingOnly = statusFor({
    activeGoal,
    candidate: doc({ queryIds: ["q_old"], viewIds: ["v_old"], layoutViewIds: ["v_old"] }),
  });
  assert.equal(existingOnly.query.exists, false);
  assert.equal(existingOnly.view.exists, false);

  const ownership: AuthoringWorkingDraftOwnership = {
    byArtifactId: {
      q_old: {
        goalId: activeGoal.id,
        artifactKind: "query",
        artifactId: "q_old",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      q_new: {
        goalId: activeGoal.id,
        artifactKind: "query",
        artifactId: "q_new",
        createdAt: "2026-04-29T00:01:00.000Z",
        updatedAt: "2026-04-29T00:01:00.000Z",
      },
    },
    byGoalId: { [activeGoal.id]: ["q_old", "q_new"] },
    currentByGoal: { [activeGoal.id]: { queryId: "q_new" } },
  };
  const currentMissing = statusFor({
    activeGoal,
    candidate: doc({ queryIds: ["q_old"] }),
    ownership,
  });
  assert.equal(currentMissing.query.exists, false);
});

test("goal-scoped inspector does not use same-view bindings without ownership", () => {
  const activeGoal = goal({
    targetRefs: {
      datasourceId: "ds_sales",
      table: "sales",
      queryId: "q_new",
      viewId: "v1",
    },
  });
  const sameViewOldBinding = statusFor({
    activeGoal,
    candidate: doc({
      queryIds: ["q_new", "q_old"],
      viewIds: ["v1"],
      bindingIds: ["old"],
      bindingQueryById: { old: "q_old" },
    }),
  });

  assert.equal(sameViewOldBinding.binding.exists, false);
  assert.equal(sameViewOldBinding.binding.valid, false);
  assert.deepEqual(sameViewOldBinding.binding.missingSlots, ["x", "y"]);
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(activeGoal),
      contextStatus: context(),
      artifactStatus: sameViewOldBinding,
      approvalState: approval(),
    }),
    { kind: "stage_binding", tool: "upsertBinding" },
  );
});

test("goal-scoped inspector rejects bindings that target a stale query", () => {
  const activeGoal = goal({
    targetRefs: {
      datasourceId: "ds_sales",
      table: "sales",
      queryId: "q_new",
      viewId: "v1",
    },
  });
  const ownership: AuthoringWorkingDraftOwnership = {
    byArtifactId: {
      q_new: {
        goalId: activeGoal.id,
        artifactKind: "query",
        artifactId: "q_new",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      v1: {
        goalId: activeGoal.id,
        artifactKind: "view",
        artifactId: "v1",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      b1_x: {
        goalId: activeGoal.id,
        artifactKind: "binding",
        artifactId: "b1_x",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      b1_y: {
        goalId: activeGoal.id,
        artifactKind: "binding",
        artifactId: "b1_y",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
    },
    byGoalId: { [activeGoal.id]: ["q_new", "v1", "b1_x", "b1_y"] },
    currentByGoal: {
      [activeGoal.id]: {
        queryId: "q_new",
        viewId: "v1",
        bindingIds: ["b1_x", "b1_y"],
      },
    },
  };
  const staleBinding = statusFor({
    activeGoal,
    candidate: doc({
      queryIds: ["q_new", "q_old"],
      viewIds: ["v1"],
      bindingIds: ["b1"],
      bindingQueryById: { b1: "q_old" },
    }),
    ownership,
  });

  assert.equal(staleBinding.binding.exists, true);
  assert.equal(staleBinding.binding.valid, false);
  assert.deepEqual(staleBinding.binding.missingSlots, ["x", "y"]);
  assert.ok(staleBinding.binding.issues.includes("stale_query_binding"));
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(activeGoal),
      contextStatus: context(),
      artifactStatus: staleBinding,
      approvalState: approval(),
    }),
    { kind: "stage_binding", tool: "upsertBinding" },
  );

  const currentBinding = statusFor({
    activeGoal,
    candidate: doc({
      queryIds: ["q_new", "q_old"],
      viewIds: ["v1"],
      bindingIds: ["old", "b1"],
      bindingQueryById: { old: "q_old", b1: "q_new" },
    }),
    ownership,
  });
  assert.equal(currentBinding.binding.exists, true);
  assert.equal(currentBinding.binding.valid, true);
  assert.deepEqual(currentBinding.binding.missingSlots, []);
  assert.equal(currentBinding.binding.issues.includes("stale_query_binding"), false);
});

test("context freshness and data-format gates choose the correct prepare action", () => {
  const activeGoal = goal();
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(activeGoal),
      contextStatus: context({
        schemaLoadedFor: {
          datasourceId: "ds_sales",
          table: "other_table",
          loadedAt: "2026-04-29T00:00:00.000Z",
        },
      }),
      artifactStatus: statusFor({ activeGoal }),
      approvalState: approval(),
    }),
    { kind: "prepare_query_context", tool: "getSchemaByDatasource" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(goal({
        contextRefs: { schemaFingerprint: "schema_old" },
      })),
      contextStatus: context({
        schemaLoadedFor: {
          datasourceId: "ds_sales",
          table: "sales",
          fingerprint: "schema_new",
          loadedAt: "2026-04-29T00:00:00.000Z",
        },
      }),
      artifactStatus: statusFor({ activeGoal }),
      approvalState: approval(),
    }),
    { kind: "prepare_query_context", tool: "getSchemaByDatasource" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(activeGoal),
      contextStatus: context({
        chartSkillLoadedFor: {
          chartType: "bar",
          referenceKey: "echarts-skills/bar-category",
          loadedAt: "2026-04-29T00:00:00.000Z",
        },
      }),
      artifactStatus: statusFor({ activeGoal }),
      approvalState: approval(),
    }),
    { kind: "prepare_view_context", tool: "loadSkillReference", referenceKind: "chart" },
  );

  const missingBinding = statusFor({
    activeGoal: goal({ targetRefs: { datasourceId: "ds_sales", table: "sales", queryId: "q1", viewId: "v1" } }),
    candidate: doc({ queryIds: ["q1"], viewIds: ["v1"] }),
  });
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(goal({ targetRefs: { datasourceId: "ds_sales", table: "sales", queryId: "q1", viewId: "v1" } })),
      contextStatus: context({ dataFormatSkillLoadedFor: undefined }),
      artifactStatus: missingBinding,
      approvalState: approval(),
    }),
    { kind: "prepare_view_context", tool: "loadSkillReference", referenceKind: "data_format" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { dataMode: "live" } },
      workflowState: workflow(goal({ targetRefs: { datasourceId: "ds_sales", table: "sales", queryId: "q1", viewId: "v1" } })),
      contextStatus: context({
        dataFormatSkillLoadedFor: {
          shape: "category_series",
          referenceKey: "data-format-skills/category-series",
          loadedAt: "2026-04-29T00:00:00.000Z",
        },
      }),
      artifactStatus: missingBinding,
      approvalState: approval(),
    }),
    { kind: "prepare_view_context", tool: "loadSkillReference", referenceKind: "data_format" },
  );
});

test("approval applies only from a matching UI approval event", () => {
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_2", decision: "approve", baseVersion: 1 },
      workflowState: { ...workflow(goal()), pendingProposalId: "patch_1" },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: true }),
    }),
    { kind: "answer", reason: "no_approved_pending_proposal" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_1", decision: "approve", baseVersion: 2 },
      workflowState: { ...workflow(goal()), pendingProposalId: "patch_1", pendingProposalBaseVersion: 1 },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: true }),
    }),
    { kind: "answer", reason: "no_approved_pending_proposal" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_1", decision: "approve", baseVersion: 1 },
      workflowState: { ...workflow(goal()), pendingProposalId: "patch_1", pendingProposalBaseVersion: 1 },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: true }),
    }),
    { kind: "apply_patch", tool: "applyPatch" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_1", decision: "reject", baseVersion: 1 },
      workflowState: { ...workflow(goal()), pendingProposalId: "patch_1", pendingProposalBaseVersion: 1 },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: false }),
    }),
    { kind: "reject_patch", proposalId: "patch_1", reason: "proposal_rejected" },
  );
});

test("tool step preparation forces tool actions and exposes no tools for terminal actions", () => {
  assert.deepEqual(prepareToolStepV2({ kind: "stage_layout", tool: "upsertLayout" }), {
    mode: "forced",
    activeTools: ["upsertLayout"],
    toolChoice: { type: "tool", toolName: "upsertLayout" },
  });
  assert.deepEqual(prepareToolStepV2({ kind: "stage_query", tool: "upsertQuery" }), {
    mode: "forced",
    activeTools: ["upsertQuery"],
    toolChoice: { type: "tool", toolName: "upsertQuery" },
  });
  assert.deepEqual(prepareToolStepV2({ kind: "run_check", tool: "runCheck" }), {
    mode: "forced",
    activeTools: ["runCheck"],
    toolChoice: { type: "tool", toolName: "runCheck" },
  });
  assert.deepEqual(prepareToolStepV2({ kind: "answer", reason: "done" }), {
    mode: "terminal",
    activeTools: [],
    toolChoice: "none",
  });
  assert.deepEqual(prepareToolStepV2({ kind: "reject_patch", proposalId: "patch_1", reason: "proposal_rejected" }), {
    mode: "terminal",
    activeTools: [],
    toolChoice: "none",
  });
});

test("v2 lifecycle capability allows compose only for dashboard lifecycle scope", () => {
  const composeAction = { kind: "compose_patch", tool: "composePatch" } as const;

  assert.equal(
    isWorkflowToolAllowedV2({
      action: composeAction,
      scopedTools: ["getDraftStatus", "upsertView", "upsertLayout"],
      scope: { kind: "dashboard" },
      intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
    }),
    true,
  );
  assert.equal(
    isWorkflowToolAllowedV2({
      action: composeAction,
      scopedTools: ["getDraftStatus", "upsertView", "upsertLayout"],
      scope: { kind: "focused", viewId: "v1" },
      intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
    }),
    false,
  );
  assert.equal(
    isWorkflowToolAllowedV2({
      action: composeAction,
      scopedTools: ["getDraftStatus", "getViews"],
      scope: { kind: "dashboard" },
      intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
    }),
    false,
  );
});

test("decideNextActionV2 applies tool boundary inside the pure workflow decision", () => {
  const activeGoal = goal({
    targetRefs: {
      datasourceId: "ds_sales",
      table: "sales",
      queryId: "q1",
      viewId: "v1",
      bindingIds: ["b1_x", "b1_y"],
    },
  });
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
      workflowState: workflow(activeGoal),
      contextStatus: context(),
      artifactStatus: statusFor({
        activeGoal,
        candidate: doc({ queryIds: ["q1"], viewIds: ["v1"], bindingIds: ["b1"], layoutViewIds: ["v1"] }),
        runtimeCheck: { required: true, status: "passed", errors: [] },
      }),
      approvalState: approval(),
      toolAvailability: {
        scopedTools: ["getDraftStatus", "getViews"],
        scope: { kind: "focused", viewId: "v1" },
        intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
      },
    }),
    {
      kind: "block_goal",
      blocker: "tool_not_allowed",
      reason: "The workflow selected composePatch, but the current scope does not allow that tool.",
    },
  );
});

test("pending proposals become stale when the candidate fingerprint changes or is missing", () => {
  const activeGoal = goal({
    targetRefs: {
      datasourceId: "ds_sales",
      table: "sales",
      queryId: "q1",
      viewId: "v1",
      bindingIds: ["b1_x", "b1_y"],
    },
  });
  const candidate = doc({ queryIds: ["q1"], viewIds: ["v1"], bindingIds: ["b1"], layoutViewIds: ["v1"] });
  const stale = statusFor({
    activeGoal,
    candidate,
    candidateFingerprint: "fp_new",
    pendingProposalId: "patch_1",
    pendingProposalDraftFingerprint: "fp_old",
    runtimeCheck: { required: true, status: "passed", errors: [] },
  });
  assert.equal(stale.patch.stale, true);
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
      workflowState: { ...workflow(activeGoal), pendingProposalId: "patch_1", pendingProposalDraftFingerprint: "fp_old" },
      contextStatus: context(),
      artifactStatus: stale,
      approvalState: approval(),
    }),
    { kind: "compose_patch", tool: "composePatch" },
  );

  const fresh = statusFor({
    activeGoal,
    candidate,
    candidateFingerprint: "fp_same",
    pendingProposalId: "patch_1",
    pendingProposalDraftFingerprint: "fp_same",
    runtimeCheck: { required: true, status: "passed", errors: [] },
  });
  assert.equal(fresh.patch.stale, false);
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
      workflowState: { ...workflow(activeGoal), pendingProposalId: "patch_1", pendingProposalDraftFingerprint: "fp_same" },
      contextStatus: context(),
      artifactStatus: fresh,
      approvalState: approval(),
    }),
    { kind: "await_approval" },
  );
});

test("dashboard parent composes only after every childGoalId is completed", () => {
  const parent = goal({
    id: "goal_parent",
    kind: "create_dashboard",
    summary: "Sales dashboard",
    childGoalIds: ["goal_child_1", "goal_child_2"],
  });
  const childOne = goal({ id: "goal_child_1", parentGoalId: parent.id, status: "completed" });
  const childTwo = goal({ id: "goal_child_2", parentGoalId: parent.id, status: "blocked" });
  const parentState: WorkflowStateV2 = {
    goals: [parent, childOne, childTwo],
    activeGoalId: parent.id,
  };

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_dashboard", goal: { dataMode: "mock", views: [{ chartType: "line" }] } },
      workflowState: parentState,
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: parent }),
      approvalState: approval(),
    }),
    {
      kind: "block_goal",
      blocker: "incomplete_dashboard_children",
      reason: "Dashboard proposal cannot be composed before every child goal is completed.",
    },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_dashboard", goal: { dataMode: "mock", views: [{ chartType: "line" }] } },
      workflowState: {
        ...parentState,
        goals: [parent, childOne, { ...childTwo, status: "completed" }],
      },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: parent }),
      approvalState: approval(),
    }),
    { kind: "compose_patch", tool: "composePatch" },
  );
});

test("block_goal transition persists blocker state", () => {
  const activeGoal = goal();
  const awaiting = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: {
      kind: "ask_user",
      blocker: "ambiguous_data_mode",
      question: "mock or live?",
    },
    now: "2026-04-29T00:30:00.000Z",
  });
  assert.equal(getActiveGoalV2(awaiting)?.status, "awaiting_user");
  assert.deepEqual(getActiveGoalV2(awaiting)?.blockers, [
    { kind: "ambiguous_data_mode", message: "mock or live?" },
  ]);

  const next = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "block_goal", blocker: "check_failed", reason: "Runtime failed" },
    now: "2026-04-29T01:00:00.000Z",
  });
  assert.equal(getActiveGoalV2(next)?.status, "blocked");
  assert.deepEqual(getActiveGoalV2(next)?.blockers, [
    { kind: "check_failed", message: "Runtime failed" },
  ]);
});

test("workflow transitions persist and clear pending proposal version", () => {
  const activeGoal = goal();
  const composed = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "compose_patch", tool: "composePatch" },
    toolExecution: { status: "succeeded", output: { suggestion: { id: "patch_1" }, draft_fingerprint: "fp_1" } },
    baseVersion: 7,
    now: "2026-04-29T01:00:00.000Z",
  });

  assert.equal(composed.pendingProposalId, "patch_1");
  assert.equal(composed.pendingProposalBaseVersion, 7);
  assert.equal(composed.pendingProposalDraftFingerprint, "fp_1");
  assert.equal(getActiveGoalV2(composed)?.status, "awaiting_approval");

  const rejected = applyWorkflowTransitionV2({
    state: composed,
    action: { kind: "reject_patch", proposalId: "patch_1", reason: "proposal_rejected" },
    now: "2026-04-29T01:01:00.000Z",
  });

  assert.equal(rejected.pendingProposalId, undefined);
  assert.equal(rejected.pendingProposalBaseVersion, undefined);
  assert.equal(rejected.pendingProposalDraftFingerprint, undefined);
  assert.equal(getActiveGoalV2(rejected)?.status, "blocked");

  const applied = applyWorkflowTransitionV2({
    state: composed,
    action: { kind: "apply_patch", tool: "applyPatch" },
    toolExecution: { status: "succeeded", output: { applied: true } },
    now: "2026-04-29T01:02:00.000Z",
  });

  assert.equal(applied.pendingProposalId, undefined);
  assert.equal(applied.pendingProposalBaseVersion, undefined);
  assert.equal(applied.pendingProposalDraftFingerprint, undefined);
  assert.equal(applied.goals[0]?.status, "completed");
});

test("workflow transitions fail closed when compose/apply tools fail or return invalid output", () => {
  const activeGoal = goal();

  const composeError = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "compose_patch", tool: "composePatch" },
    toolExecution: {
      status: "failed",
      reason: "tool_error",
      message: "composePatch failed",
    },
    baseVersion: 7,
    now: "2026-04-29T02:00:00.000Z",
  });
  assert.equal(composeError.pendingProposalId, undefined);
  assert.equal(composeError.pendingProposalBaseVersion, undefined);
  assert.equal(getActiveGoalV2(composeError)?.status, "blocked");
  assert.deepEqual(getActiveGoalV2(composeError)?.blockers.at(-1), {
    kind: "compose_patch_failed",
    message: "composePatch failed",
  });

  const composeMissingResult = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "compose_patch", tool: "composePatch" },
    now: "2026-04-29T02:01:00.000Z",
  });
  assert.equal(getActiveGoalV2(composeMissingResult)?.status, "blocked");
  assert.deepEqual(getActiveGoalV2(composeMissingResult)?.blockers.at(-1), {
    kind: "compose_patch_failed",
    message: "composePatch did not return a successful tool result.",
  });

  const composeInvalid = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "compose_patch", tool: "composePatch" },
    toolExecution: { status: "succeeded", output: { suggestion: {} } },
    baseVersion: 7,
    now: "2026-04-29T02:02:00.000Z",
  });
  assert.equal(composeInvalid.pendingProposalId, undefined);
  assert.equal(getActiveGoalV2(composeInvalid)?.status, "blocked");
  assert.deepEqual(getActiveGoalV2(composeInvalid)?.blockers.at(-1), {
    kind: "compose_patch_invalid_output",
    message: "composePatch succeeded without a valid patch proposal id and draft fingerprint.",
  });

  const awaitingApproval = workflow(activeGoal);
  awaitingApproval.pendingProposalId = "patch_1";
  awaitingApproval.pendingProposalBaseVersion = 7;
  awaitingApproval.pendingProposalDraftFingerprint = "fp_1";

  const applyError = applyWorkflowTransitionV2({
    state: awaitingApproval,
    action: { kind: "apply_patch", tool: "applyPatch" },
    toolExecution: {
      status: "failed",
      reason: "semantic_error",
      message: "applyPatch failed",
    },
    now: "2026-04-29T02:03:00.000Z",
  });
  assert.equal(applyError.pendingProposalId, undefined);
  assert.equal(applyError.pendingProposalBaseVersion, undefined);
  assert.equal(applyError.pendingProposalDraftFingerprint, undefined);
  assert.equal(getActiveGoalV2(applyError)?.status, "blocked");
  assert.deepEqual(getActiveGoalV2(applyError)?.blockers.at(-1), {
    kind: "apply_patch_failed",
    message: "applyPatch failed",
  });

  const applyInvalid = applyWorkflowTransitionV2({
    state: awaitingApproval,
    action: { kind: "apply_patch", tool: "applyPatch" },
    toolExecution: { status: "succeeded", output: { applied: false } },
    now: "2026-04-29T02:04:00.000Z",
  });
  assert.equal(applyInvalid.pendingProposalId, undefined);
  assert.equal(applyInvalid.pendingProposalBaseVersion, undefined);
  assert.equal(applyInvalid.pendingProposalDraftFingerprint, undefined);
  assert.equal(getActiveGoalV2(applyInvalid)?.status, "blocked");
  assert.deepEqual(getActiveGoalV2(applyInvalid)?.blockers.at(-1), {
    kind: "apply_patch_invalid_output",
    message: "applyPatch succeeded without confirming that the patch was applied.",
  });
});

test("run_check failure blocks the goal without auto repair", () => {
  const activeGoal = goal({
    targetRefs: {
      datasourceId: "ds_sales",
      table: "sales",
      queryId: "q1",
      viewId: "v1",
      bindingIds: ["b1_x", "b1_y"],
    },
  });
  const initial = workflow(activeGoal);

  const afterRunCheck = applyWorkflowTransitionV2({
    state: initial,
    action: { kind: "run_check", tool: "runCheck" },
    toolExecution: { status: "failed", reason: "semantic_error", message: "Renderer failed" },
    now: "2026-04-29T03:00:00.000Z",
  });

  assert.equal(getActiveGoalV2(afterRunCheck)?.status, "blocked");
  assert.deepEqual(getActiveGoalV2(afterRunCheck)?.blockers.at(-1), {
    kind: "check_failed",
    message: "Renderer failed",
  });

  const failedCheckStatus = statusFor({
    activeGoal,
    candidate: doc({ queryIds: ["q1"], viewIds: ["v1"], bindingIds: ["b1"], layoutViewIds: ["v1"] }),
    runtimeCheck: {
      required: true,
      status: "failed",
      errors: [{ code: "runtime", message: "Renderer failed" }],
    },
  });
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "create_view", goal: { chartType: "line", dataMode: "live" } },
      workflowState: workflow(activeGoal),
      contextStatus: context(),
      artifactStatus: failedCheckStatus,
      approvalState: approval(),
    }),
    {
      kind: "block_goal",
      blocker: "check_failed",
      reason: "Renderer failed",
    },
  );
});
