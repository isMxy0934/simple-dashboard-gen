import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { DashboardDocument } from "../src/contracts/dashboard.ts";
import type { AuthoringWorkingDraftOwnership } from "../src/ai/authoring/contracts/session-state.ts";
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
  inspectArtifactsV2,
  isWorkflowToolAllowedV2,
  prepareForcedToolStepV2,
  reduceIntentToWorkflowStateV2,
  resolveIntentV2,
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
  return { activeGoal };
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
}) {
  return inspectArtifactsV2({
    goal: input.activeGoal === undefined ? goal() : input.activeGoal,
    candidate: input.candidate ?? doc(),
    ownership: input.ownership,
    runtimeCheck: input.runtimeCheck,
    pendingProposalId: input.pendingProposalId,
  });
}

test("explore_data reads only when context is missing and answers when ready", () => {
  const missing = decideNextActionV2({
    intent: { kind: "explore_data", scope: "datasources" },
    workflowState: workflow(null),
    contextStatus: context({ datasourcesLoaded: false }),
    artifactStatus: statusFor({ activeGoal: null }),
    approvalState: approval(),
  });
  assert.deepEqual(missing, { kind: "prepare_data_context", tool: "getDatasources" });

  const ready = decideNextActionV2({
    intent: { kind: "explore_data", scope: "datasources" },
    workflowState: workflow(null),
    contextStatus: context({ datasourcesLoaded: true }),
    artifactStatus: statusFor({ activeGoal: null }),
    approvalState: approval(),
  });
  assert.deepEqual(ready, { kind: "answer", reason: "data_context_ready" });
});

test("resolveIntentV2 does not classify affirmative create requests as approval", () => {
  assert.deepEqual(
    resolveIntentV2({ latestUserText: "可以 先搭建一个每周 GMV 趋势图表" }),
    {
      kind: "create_view",
      goal: {
        summary: "可以 先搭建一个每周 GMV 趋势图表",
        chartType: "line",
      },
    },
  );

  assert.deepEqual(resolveIntentV2({ latestUserText: "确认" }), {
    kind: "approve_patch_text",
    decision: "approve",
  });

  assert.deepEqual(resolveIntentV2({ latestUserText: "先用 mock 数据" }), {
    kind: "set_data_mode",
    dataMode: "mock",
  });
});

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

  assert.equal(next.activeGoal?.id, awaitingGoal.id);
  assert.equal(next.activeGoal?.status, "active");
  assert.equal(next.activeGoal?.dataMode, "mock");
  assert.deepEqual(next.activeGoal?.blockers, []);
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
      reason:
        "Runtime check failed. MVP does not auto-repair; stop and surface the error.",
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
      question: "你想创建折线图、柱状图，还是 KPI 指标卡？",
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
        "This chart type is outside the v2.1 MVP workflow. Supported chart types are line, bar, and kpi.",
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

test("approval text never applies while matching approval event does", () => {
  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_text", decision: "approve" },
      workflowState: { activeGoal: goal(), pendingProposalId: "patch_1" },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", source: "text", userApproved: false }),
    }),
    { kind: "await_approval" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_2", decision: "approve", baseVersion: 1 },
      workflowState: { activeGoal: goal(), pendingProposalId: "patch_1" },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: true }),
    }),
    { kind: "answer", reason: "no_approved_pending_proposal" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_1", decision: "approve", baseVersion: 2 },
      workflowState: { activeGoal: goal(), pendingProposalId: "patch_1", pendingProposalBaseVersion: 1 },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: true }),
    }),
    { kind: "answer", reason: "no_approved_pending_proposal" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_1", decision: "approve", baseVersion: 1 },
      workflowState: { activeGoal: goal(), pendingProposalId: "patch_1", pendingProposalBaseVersion: 1 },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: true }),
    }),
    { kind: "apply_patch", tool: "applyPatch" },
  );

  assert.deepEqual(
    decideNextActionV2({
      intent: { kind: "approve_patch_event", proposalId: "patch_1", decision: "reject", baseVersion: 1 },
      workflowState: { activeGoal: goal(), pendingProposalId: "patch_1", pendingProposalBaseVersion: 1 },
      contextStatus: context(),
      artifactStatus: statusFor({ activeGoal: goal(), pendingProposalId: "patch_1" }),
      approvalState: approval({ pendingProposalId: "patch_1", pendingProposalBaseVersion: 1, source: "ui_event", userApproved: false }),
    }),
    { kind: "reject_patch", proposalId: "patch_1", reason: "proposal_rejected" },
  );
});

test("forced tool step exposes only the selected tool and terminal actions expose none", () => {
  assert.deepEqual(prepareForcedToolStepV2({ kind: "stage_layout", tool: "upsertLayout" }), {
    activeTools: ["upsertLayout"],
    toolChoice: { type: "tool", toolName: "upsertLayout" },
  });
  assert.deepEqual(prepareForcedToolStepV2({ kind: "answer", reason: "done" }), {
    activeTools: [],
    toolChoice: "none",
  });
  assert.deepEqual(prepareForcedToolStepV2({ kind: "reject_patch", proposalId: "patch_1", reason: "proposal_rejected" }), {
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
  assert.equal(awaiting.activeGoal?.status, "awaiting_user");
  assert.deepEqual(awaiting.activeGoal?.blockers, [
    { kind: "ambiguous_data_mode", message: "mock or live?" },
  ]);

  const next = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "block_goal", blocker: "check_failed", reason: "Runtime failed" },
    now: "2026-04-29T01:00:00.000Z",
  });
  assert.equal(next.activeGoal?.status, "blocked");
  assert.deepEqual(next.activeGoal?.blockers, [
    { kind: "check_failed", message: "Runtime failed" },
  ]);
});

test("workflow transitions persist and clear pending proposal version", () => {
  const activeGoal = goal();
  const composed = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "compose_patch", tool: "composePatch" },
    toolExecution: { status: "succeeded", output: { suggestion: { id: "patch_1" } } },
    baseVersion: 7,
    now: "2026-04-29T01:00:00.000Z",
  });

  assert.equal(composed.pendingProposalId, "patch_1");
  assert.equal(composed.pendingProposalBaseVersion, 7);
  assert.equal(composed.activeGoal?.status, "awaiting_approval");

  const rejected = applyWorkflowTransitionV2({
    state: composed,
    action: { kind: "reject_patch", proposalId: "patch_1", reason: "proposal_rejected" },
    now: "2026-04-29T01:01:00.000Z",
  });

  assert.equal(rejected.pendingProposalId, undefined);
  assert.equal(rejected.pendingProposalBaseVersion, undefined);
  assert.equal(rejected.activeGoal?.status, "blocked");

  const applied = applyWorkflowTransitionV2({
    state: composed,
    action: { kind: "apply_patch", tool: "applyPatch" },
    toolExecution: { status: "succeeded", output: { applied: true } },
    now: "2026-04-29T01:02:00.000Z",
  });

  assert.equal(applied.pendingProposalId, undefined);
  assert.equal(applied.pendingProposalBaseVersion, undefined);
  assert.equal(applied.activeGoal?.status, "completed");
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
  assert.equal(composeError.activeGoal?.status, "blocked");
  assert.deepEqual(composeError.activeGoal?.blockers.at(-1), {
    kind: "compose_patch_failed",
    message: "composePatch failed",
  });

  const composeMissingResult = applyWorkflowTransitionV2({
    state: workflow(activeGoal),
    action: { kind: "compose_patch", tool: "composePatch" },
    now: "2026-04-29T02:01:00.000Z",
  });
  assert.equal(composeMissingResult.activeGoal?.status, "blocked");
  assert.deepEqual(composeMissingResult.activeGoal?.blockers.at(-1), {
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
  assert.equal(composeInvalid.activeGoal?.status, "blocked");
  assert.deepEqual(composeInvalid.activeGoal?.blockers.at(-1), {
    kind: "compose_patch_invalid_output",
    message: "composePatch succeeded without a valid patch proposal id.",
  });

  const awaitingApproval = workflow(activeGoal);
  awaitingApproval.pendingProposalId = "patch_1";
  awaitingApproval.pendingProposalBaseVersion = 7;

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
  assert.equal(applyError.activeGoal?.status, "blocked");
  assert.deepEqual(applyError.activeGoal?.blockers.at(-1), {
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
  assert.equal(applyInvalid.activeGoal?.status, "blocked");
  assert.deepEqual(applyInvalid.activeGoal?.blockers.at(-1), {
    kind: "apply_patch_invalid_output",
    message: "applyPatch succeeded without confirming that the patch was applied.",
  });
});

test("run_check transition does not rely on a checkResultId contract", () => {
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
    toolExecution: {
      status: "succeeded",
      output: {
        status: "error",
        reason: "Renderer failed",
        checks: [],
        failures: [],
        renderer_checks: [],
      },
    },
    now: "2026-04-29T03:00:00.000Z",
  });

  assert.deepEqual(afterRunCheck, initial);

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
      reason:
        "Runtime check failed. MVP does not auto-repair; stop and surface the error.",
    },
  );
});
