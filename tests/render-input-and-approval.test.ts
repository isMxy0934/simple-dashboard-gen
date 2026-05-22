import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { buildAuthoringSystemPrompt } from "../src/ai/authoring/messages/system-prompt.ts";
import {
  resolveDashboardLogDirName,
  resolveSessionLogDirName,
  resolveTraceFileManifestRef,
} from "../src/server/logs/session-log-paths.ts";
import { stageChartInputSchema } from "../src/ai/authoring/tools/schemas.ts";
import { Value } from "typebox/value";
import { shouldRequestLocalPatchApproval } from "../src/web/authoring/agent/approval-state.ts";
import {
  buildDashboardExecuteBatchRequest,
  buildDashboardPreviewRequest,
} from "../src/web/dashboard/render-input.ts";
import { resolveTimeRangePreset } from "../src/domain/shared/filter-resolution.ts";
import type { DashboardDocument } from "../src/contracts/dashboard.ts";
import type { AuthoringDraftOutput } from "../src/ai/authoring/contracts/tool-io.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { listAuthoringSkills, loadAuthoringSkill } = await import(
  "../src/server/ai/skill-loader.ts"
);

const dashboard = {
  schema_version: "1.0",
  dashboard_spec: {
    schema_version: "0.3",
    presentation: {
      design_kit_id: "operational_report",
      color_theme_id: "purple",
      default_view_style_id: "emphasis",
    },
    dashboard: { name: "Contract Dashboard" },
    filters: [
      {
        id: "f_time_range",
        kind: "time_range",
        label: "Time",
        default_value: "today",
        resolved_fields: ["start", "end", "timezone"],
      },
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
          recipe_id: "echarts-bar",
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
} satisfies DashboardDocument;

test("preview and viewer batch share filter/runtime contract", () => {
  const preview = buildDashboardPreviewRequest({
    dashboard,
    visibleViewIds: ["v_orders"],
    selectedTimeRange: "this_week",
  });
  const batch = buildDashboardExecuteBatchRequest({
    dashboardId: "db_1",
    version: 3,
    dashboard,
    visibleViewIds: ["v_orders"],
    selectedTimeRange: "this_week",
  });

  assert.deepEqual(preview.filter_values, batch.filter_values);
  assert.deepEqual(preview.runtime_context, batch.runtime_context);
  assert.equal("workspace_id" in batch, false);
});

test("viewer filter values include contract filters and user selections", () => {
  const batch = buildDashboardExecuteBatchRequest({
    dashboardId: "db_1",
    version: 3,
    dashboard,
    visibleViewIds: ["v_orders"],
    selectedFilterValues: {
      f_time_range: "today",
      f_channel: "web",
    },
  });

  assert.deepEqual(batch.filter_values, {
    f_time_range: "today",
    f_channel: "web",
  });
});

test("time range presets resolve by Asia/Shanghai calendar day", () => {
  const resolved = resolveTimeRangePreset(
    "today",
    "Asia/Shanghai",
    new Date("2026-05-07T17:30:00.000Z"),
  );

  assert.equal(resolved.start, "2026-05-08");
  assert.equal(resolved.end, "2026-05-09");
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
    base_document_fingerprint: "base_fp_1",
    draft_fingerprint: "draft_fp_1",
    stabilization: { status: "not-needed", checked: true, notes: [] },
  } satisfies AuthoringDraftOutput;

  assert.equal(
    shouldRequestLocalPatchApproval({
      latestDraftOutput: draft,
      locallyResolvedSuggestionIds: new Set(),
      currentDocumentHash: "base_fp_1",
    }),
    true,
  );
  assert.equal(
    shouldRequestLocalPatchApproval({
      latestDraftOutput: draft,
      locallyResolvedSuggestionIds: new Set(),
      currentDocumentHash: "base_fp_2",
    }),
    false,
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

test("authoring prompt keeps mode boundaries and omits task state", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
  });

  assert.match(prompt, /runtime exposes only the tools allowed/i);
  assert.match(prompt, /decide the next useful tool call yourself/i);
  assert.match(prompt, /choose one chart skill id/i);
  assert.match(prompt, /If no available chart skill matches/i);
  assert.match(prompt, /Do not emit multi-step implementation plans, checklists, or internal sequencing/i);
  assert.match(prompt, /Advisory-only questions/i);
  assert.match(prompt, /销售数据分析该怎么做/i);
  assert.match(prompt, /Low-level upsertQuery, upsertView, upsertBinding, and upsertLayout are not available/i);
  assert.doesNotMatch(prompt, /Load the selected chart skill/i);
  assert.doesNotMatch(prompt, /stageChart as the single write transaction/i);
  assert.doesNotMatch(prompt, /stageChart stages query, view, bindings, and layout atomically/i);
  assert.doesNotMatch(prompt, /Never write SQL, QueryDef\.output, renderer\.option_template/i);
  assert.doesNotMatch(prompt, /Current task state/i);
  assert.doesNotMatch(prompt, /three KPI cards, default to a horizontal equal-width row/i);
  assert.doesNotMatch(prompt, /Default count metrics to integers, money and AOV metrics to two decimals/i);
  assert.doesNotMatch(prompt, /listing the intended steps as a checklist/i);
  assert.doesNotMatch(prompt, /The code does not infer natural-language intent/i);
  assert.doesNotMatch(prompt, /continue in the same turn/i);
  assert.doesNotMatch(prompt, /in the same turn, call getSchemaByDatasource/i);
  assert.doesNotMatch(prompt, /call upsertBinding/i);
  assert.doesNotMatch(prompt, /call upsertBinding next/i);
  assert.doesNotMatch(prompt, /After composePatch succeeds, stop/i);
  assert.doesNotMatch(prompt, /Do not end the turn after only/i);
});

test("inspect prompt only advertises read-only inspection behavior", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "inspect", "dashboard"],
    scope: { kind: "dashboard" },
  });

  assert.match(prompt, /read-only inspection tools/i);
  assert.doesNotMatch(prompt, /declareAuthoringGoal/i);
  assert.doesNotMatch(prompt, /declaring a chart goal/i);
});

test("chart skills are dynamically loadable as independent manuals", async () => {
  const skills = await listAuthoringSkills();

  assert.ok(skills.some((skill) => skill.id === "echarts-line"));
  assert.ok(skills.some((skill) => skill.id === "echarts-kpi-text"));
  assert.equal(skills.some((skill) => skill.id === "data-format-skills"), false);
  const line = await loadAuthoringSkill("echarts-line");
  const kpi = await loadAuthoringSkill("echarts-kpi-text");

  assert.ok(line);
  assert.match(line.content, /fields\.time\.source_field/i);
  assert.match(line.content, /Runtime Contract/i);
  assert.equal(line.content.includes("skill-check"), false);
  assert.ok(kpi);
  assert.match(kpi.content, /fields\.value\.source_field/i);
});

test("stageChart schema rejects model-authored query contracts", () => {
  assert.throws(() =>
    Value.Parse(stageChartInputSchema, {
      skill_id: "echarts-line",
      title: "GMV trend",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: {
        time: { source_field: "week_start" },
        metric: { source_field: "gmv", aggregation: "sum" },
      },
      query: {
        sql_template: "select * from sales_weekly_fact",
        output: { kind: "rows", schema: [] },
      },
    }),
  );
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
