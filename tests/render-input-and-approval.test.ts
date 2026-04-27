import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { hasConfirmedDataContext } from "../src/ai/authoring/data-context-gate.ts";
import { buildAuthoringSystemPrompt } from "../src/ai/authoring/prompt.ts";
import {
  resolveDashboardLogDirName,
  resolveSessionLogDirName,
  resolveTraceFileManifestRef,
} from "../src/server/logs/session-log-paths.ts";
import { upsertViewInputSchema } from "../src/ai/authoring/tools/schemas.ts";
import { shouldRequestLocalPatchApproval } from "../src/web/authoring/agent/approval-state.ts";
import {
  buildDashboardExecuteBatchRequest,
  buildDashboardPreviewRequest,
} from "../src/web/dashboard/render-input.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { listAuthoringSkills, loadAuthoringSkillReference } = await import(
  "../src/server/ai/skill-loader.ts"
);

const dashboard = {
  dashboard_spec: {
    schema_version: "0.2",
    dashboard: { name: "Contract Dashboard" },
    filters: [
      { id: "f_time_range", kind: "time_range", label: "Time", default_value: "today" },
      {
        id: "f_channel",
        kind: "single_select",
        label: "Channel",
        default_value: "all",
        options: [{ label: "All", value: "all" }],
      },
    ],
    views: [
      {
        id: "v_orders",
        title: "Orders",
        renderer: {
          kind: "echarts",
          option_template: { series: [] },
          slots: [],
        },
      },
    ],
    layout: {
      desktop: { cols: 12, row_height: 80, items: [{ view_id: "v_orders", x: 0, y: 0, w: 3, h: 2 }] },
      mobile: { cols: 4, row_height: 80, items: [{ view_id: "v_orders", x: 0, y: 0, w: 4, h: 2 }] },
    },
  },
  query_defs: [],
  bindings: [],
};

test("preview and viewer batch share filter/runtime contract", () => {
  const preview = buildDashboardPreviewRequest({
    dashboard,
    visibleViewIds: ["v_orders"],
    selectedTimeRange: "this_week",
  });
  const batch = buildDashboardExecuteBatchRequest({
    workspaceId: "ws_acme",
    dashboardId: "db_1",
    version: 3,
    dashboard,
    visibleViewIds: ["v_orders"],
    selectedTimeRange: "this_week",
  });

  assert.deepEqual(preview.filter_values, batch.filter_values);
  assert.deepEqual(preview.runtime_context, batch.runtime_context);
  assert.equal(batch.workspace_id, "ws_acme");
});

test("composePatch output requests local approval until applied or resolved", () => {
  const draft = {
    suggestion: {
      id: "patch-1",
      kind: "data",
      title: "Patch",
      summary: "Patch summary",
      details: [],
      patch: { summary: "Patch summary", operations: [] },
      dashboard,
    },
    approval: {
      required: true,
      status: "pending",
      summary: "Approval required",
      operation_count: 1,
      affected_paths: ["dashboard_spec.views.v_orders"],
    },
    repair: { status: "not_needed", notes: [] },
  };

  assert.equal(
    shouldRequestLocalPatchApproval({
      latestDraftOutput: draft,
      locallyResolvedSuggestionIds: new Set(),
    }),
    true,
  );
  assert.equal(
    shouldRequestLocalPatchApproval({
      latestDraftOutput: draft,
      latestAppliedSuggestionId: "patch-1",
      locallyResolvedSuggestionIds: new Set(),
    }),
    false,
  );
  assert.equal(
    shouldRequestLocalPatchApproval({
      latestDraftOutput: draft,
      locallyResolvedSuggestionIds: new Set(["patch-1"]),
    }),
    false,
  );
});

test("vague sales analysis request is not confirmed data context", () => {
  const datasources = [
    {
      datasource_id: "testing-db",
      label: "testing-db",
    },
  ];

  assert.equal(
    hasConfirmedDataContext({
      latestUserText: "我想看看最近的销售数据 订单数据 和 aov",
      datasources,
    }),
    false,
  );
  assert.equal(
    hasConfirmedDataContext({
      latestUserText: "请用 testing-db 的 public.sales_quality 表创建销售、订单和 aov 看板",
      datasources,
    }),
    true,
  );
});

test("authoring prompt defaults reversible KPI layout and formatting choices", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
  });

  assert.match(prompt, /load one relevant ECharts skill reference/i);
  assert.match(prompt, /one relevant data-format skill reference/i);
  assert.match(prompt, /Pass the exact loaded skill reference key/i);
  assert.match(prompt, /If no ECharts skill reference supports the requested chart type/i);
  assert.match(prompt, /Use skill references for reusable renderer, layout, output, formatting, and binding defaults/i);
  assert.match(prompt, /Layout and formatting are defaults, not blockers/i);
  assert.match(prompt, /Never ask micro-confirmation questions for reversible choices/i);
  assert.match(prompt, /If any write tool fails validation \(upsertQuery, upsertView, or upsertBinding\)/i);
  assert.match(prompt, /retry once with the canonical shape in the same turn/i);
  assert.match(prompt, /Do not emit multi-step implementation plans, checklists, or internal sequencing/i);
  assert.match(prompt, /Do not call write tools for advisory-only questions/i);
  assert.match(prompt, /销售数据分析该怎么做/i);
  assert.match(prompt, /A concrete visualization request/i);
  assert.match(prompt, /If the user only confirms a broad data direction/i);
  assert.match(prompt, /Do not tell users you will confirm view structure, then add queries, then bind views, then request approval/i);
  assert.match(prompt, /Use at most one chart skill reference per chart family/i);
  assert.doesNotMatch(prompt, /three KPI cards, default to a horizontal equal-width row/i);
  assert.doesNotMatch(prompt, /Default count metrics to integers, money and AOV metrics to two decimals/i);
  assert.doesNotMatch(prompt, /listing the intended steps as a checklist/i);
});

test("data format skill references are dynamically loadable", async () => {
  const skills = await listAuthoringSkills();

  assert.ok(skills.some((skill) => skill.id === "data-format-skills"));
  const scalarKpi = await loadAuthoringSkillReference(
    "data-format-skills",
    "scalar-kpi",
  );
  const timeSeries = await loadAuthoringSkillReference(
    "data-format-skills",
    "time-series",
  );
  const detailRows = await loadAuthoringSkillReference(
    "data-format-skills",
    "detail-rows",
  );

  assert.ok(scalarKpi);
  assert.match(scalarKpi.content, /Use this reference for one headline metric/i);
  assert.match(scalarKpi.content, /output\.kind = "scalar"/i);
  assert.equal(scalarKpi.check?.kind, "data-format");
  assert.equal(scalarKpi.check?.data_shape, "scalar-kpi");
  assert.ok(timeSeries);
  assert.match(timeSeries.content, /Return one row per time bucket/i);
  assert.equal(timeSeries.check?.kind, "data-format");
  assert.equal(timeSeries.check?.data_shape, "time-series");
  assert.ok(detailRows);
  assert.match(detailRows.content, /If a table renderer is unavailable/i);
  assert.equal(detailRows.check?.view_support, "data-only");
});

test("upsertView accepts misplaced view_spec slots and canonicalizes them into renderer", () => {
  const parsed = upsertViewInputSchema.parse({
    request: "Create GMV trend",
    view_spec: {
      view_id: "vw_sales_gmv_last8",
      title: "GMV trend",
      slots: [
        { id: "x", path: "xAxis.data", value_kind: "array", required: true },
        { id: "y", path: "series[0].data", value_kind: "array", required: true },
      ],
      renderer: {
        kind: "echarts",
        option_template: {
          xAxis: { type: "category", data: [] },
          yAxis: { type: "value" },
          series: [{ type: "line", data: [] }],
        },
      },
    },
  });

  assert.equal(parsed.view_spec.renderer.slots.length, 2);
  assert.equal("slots" in parsed.view_spec, false);
});

test("session trace paths are grouped by dashboard and session hashes", () => {
  const dashboardDir = resolveDashboardLogDirName("db_f623129b");
  const sameDashboardDir = resolveDashboardLogDirName("db_f623129b");
  const otherDashboardDir = resolveDashboardLogDirName("db_other");
  const sessionDir = resolveSessionLogDirName("ws_default:usr_alice:db_f623129b:sess_1");
  const traceRef = resolveTraceFileManifestRef({
    dashboardId: "db_f623129b",
    sessionId: "ws_default:usr_alice:db_f623129b:sess_1",
  });

  assert.equal(dashboardDir, sameDashboardDir);
  assert.notEqual(dashboardDir, otherDashboardDir);
  assert.match(dashboardDir, /^dashboard-[a-f0-9]{24}$/);
  assert.match(sessionDir, /^session-[a-f0-9]{24}$/);
  assert.equal(traceRef, `${sessionDir}/trace.jsonl`);
});
