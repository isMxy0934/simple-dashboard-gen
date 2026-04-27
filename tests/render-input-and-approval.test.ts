import assert from "node:assert/strict";
import test from "node:test";
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
import {
  listAuthoringSkills,
  loadAuthoringSkillReference,
} from "../src/server/ai/skill-loader.ts";

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

test("discovery prompt presents datasource/table candidates with rationale before secondary metric details", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "discover"],
    scope: { kind: "dashboard" },
  });

  assert.match(
    prompt,
    /Present candidates in business language/i,
  );
  assert.match(
    prompt,
    /Do not make the user know table details/i,
  );
  assert.match(
    prompt,
    /Do not ask about time range, grouping, chart type, layout, formatting, colors, or titles/i,
  );
  assert.match(
    prompt,
    /the next authoring turn should create the draft with defaults/i,
  );
  assert.match(prompt, /Do not give implementation plans, checklists/i);
});

test("authoring prompt defaults reversible KPI layout and formatting choices", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
  });

  assert.match(prompt, /load the relevant data-format skill reference/i);
  assert.match(prompt, /scalar KPI, time series, multi-series time series, category comparison, or detail rows/i);
  assert.match(prompt, /Use data-format skill references for reusable layout, output, formatting, and binding defaults/i);
  assert.match(prompt, /Layout and formatting are defaults, not blockers/i);
  assert.match(prompt, /Never ask micro-confirmation questions for reversible choices/i);
  assert.match(prompt, /If any write tool fails validation \(upsertQuery, upsertView, or upsertBinding\)/i);
  assert.match(prompt, /retry once with the canonical shape in the same turn/i);
  assert.match(prompt, /Do not emit multi-step implementation plans, checklists, or internal sequencing/i);
  assert.match(prompt, /If the user confirms a datasource\/table, metric definition, report shape, or asks to create\/generate\/build/i);
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
  assert.ok(timeSeries);
  assert.match(timeSeries.content, /Return one row per time bucket/i);
  assert.ok(detailRows);
  assert.match(detailRows.content, /If a table renderer is unavailable/i);
});

test("upsertView accepts misplaced view_spec slots and canonicalizes them into renderer", () => {
  const parsed = upsertViewInputSchema.parse({
    request: "Create GMV trend",
    view_spec: {
      view_id: "vw_sales_gmv_last8",
      title: "GMV trend",
      slots: [
        { id: "x", path: "xAxis.data", value_kind: "rows", required: true },
        { id: "y", path: "series[0].data", value_kind: "rows", required: true },
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
