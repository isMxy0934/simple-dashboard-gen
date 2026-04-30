import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { buildAuthoringSystemPrompt } from "../src/ai/authoring/messages/system-prompt.ts";
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

const { listAuthoringSkills, loadAuthoringSkill } = await import(
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
    stabilization: { status: "not-needed", checked: true, notes: [] },
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

test("authoring prompt keeps workflow boundaries and omits task state", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
  });

  assert.match(prompt, /Workflow runtime resolves intent/i);
  assert.match(prompt, /currently available tool surface/i);
  assert.match(prompt, /Do not decide workflow sequencing from the prompt/i);
  assert.match(prompt, /choose one chart skill id/i);
  assert.match(prompt, /Load the selected chart skill/i);
  assert.match(prompt, /If no available chart skill matches/i);
  assert.match(prompt, /Do not emit multi-step implementation plans, checklists, or internal sequencing/i);
  assert.match(prompt, /Advisory-only questions/i);
  assert.match(prompt, /销售数据分析该怎么做/i);
  assert.match(prompt, /upsertQuery, upsertView, and upsertBinding only stage an internal working draft/i);
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

test("chart skills are dynamically loadable as independent manuals", async () => {
  const skills = await listAuthoringSkills();

  assert.ok(skills.some((skill) => skill.id === "echarts-line"));
  assert.ok(skills.some((skill) => skill.id === "echarts-kpi-text"));
  assert.equal(skills.some((skill) => skill.id === "data-format-skills"), false);
  const line = await loadAuthoringSkill("echarts-line");
  const kpi = await loadAuthoringSkill("echarts-kpi-text");

  assert.ok(line);
  assert.match(line.content, /Return one row per time bucket/i);
  assert.match(line.content, /Binding Guidance/i);
  assert.equal(line.content.includes("skill-check"), false);
  assert.ok(kpi);
  assert.match(kpi.content, /output\.kind = "scalar"/i);
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
