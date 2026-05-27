import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type {
  BindingResults,
  DatasourceContext,
  DashboardDocument,
  PreviewRequest,
} from "../src/contracts/dashboard.ts";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "../src/ai/authoring/contracts/session.ts";
import type { AuthoringDependencies } from "../src/ai/authoring/runtime/dependencies.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { buildAuthoringSystemPrompt } = await import("../src/ai/authoring/messages/system-prompt.ts");
const { buildAuthoringContextBlock } = await import(
  "../src/ai/authoring/messages/context-block.ts"
);
const {
  buildAuthorToolSurface,
  resolveRuntimeToolSurface,
  selectAuthoringToolSet,
  surfaceConfigDigest,
} = await import(
  "../src/ai/authoring/agent/tool-surface.ts"
);
const { buildAuthoringPiHooks } = await import(
  "../src/ai/authoring/agent/pi-hooks.ts"
);
const { buildAuthoringTools } = await import(
  "../src/ai/authoring/tools/factory.ts"
);
const {
  AUTHORING_TOOL_REGISTRY,
  filterAuthoringToolNamesByPermissions,
  getInspectLaneToolNames,
} = await import("../src/ai/authoring/tools/registry.ts");
const {
  buildGetTableSchemaTool,
  buildListDatasourceTablesTool,
  buildPreviewTableDataTool,
} = await import("../src/ai/authoring/tools/shared-tools.ts");
const { buildStageChartTool } = await import(
  "../src/ai/authoring/tools/stage-chart-tool.ts"
);
const { buildStageViewIntentTool } = await import(
  "../src/ai/authoring/tools/stage-view-intent-tool.ts"
);
const { buildStageReplaceChartTool } = await import(
  "../src/ai/authoring/tools/stage-replace-chart-tool.ts"
);
const { buildStageDeleteTool } = await import(
  "../src/ai/authoring/tools/stage-delete-tool.ts"
);
const {
  buildComposePatchTool,
  buildRunCheckTool,
} = await import("../src/ai/authoring/tools/write-tools.ts");
const { buildDraftStatus } = await import(
  "../src/ai/authoring/tools/draft-status.ts"
);
const {
  buildCandidateDocument,
  buildDocumentFingerprint,
} = await import("../src/ai/authoring/tools/candidate-document.ts");
const {
  createWorkingDraftState,
} = await import("../src/ai/authoring/tools/draft-state.ts");
const {
  convertToLlm,
  sanitizeAgentMessages,
  sanitizeToolCallPairs,
  transformAuthoringContext,
} = await import("../src/ai/authoring/runtime/llm-boundary.ts");
const { deriveAuthoringFacts } = await import(
  "../src/ai/authoring/runtime/derived-facts.ts"
);
const { formatAuthoringToolResultText } = await import(
  "../src/ai/authoring/runtime/tool-result-content.ts"
);
const { toPiAgentTool } = await import(
  "../src/ai/authoring/runtime/pi-tool-adapter.ts"
);
const { AuthoringToolGateError } = await import(
  "../src/ai/authoring/contracts/errors.ts"
);
const { stageChartInputSchema, stageViewIntentInputSchema } = await import(
  "../src/ai/authoring/tools/schemas.ts"
);
const { Value } = await import("typebox/value");
const { createTemporaryDashboardViewIntentForRecipe } = await import(
  "../src/contracts/dashboard-view-intent.ts"
);

type TemporaryIntentRecipeId = Parameters<
  typeof createTemporaryDashboardViewIntentForRecipe
>[0]["recipe_id"];

function testViewIntent(recipeId: TemporaryIntentRecipeId = "echarts-bar") {
  return createTemporaryDashboardViewIntentForRecipe({
    recipe_id: recipeId,
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: {
      value: {
        source_field: "gmv",
        aggregation: "sum",
      },
    },
  });
}
const { AuthoringAgentSession } = await import(
  "../src/ai/authoring/agent/session.ts"
);
const { validateAuthoringApprovalPreflight } = await import(
  "../src/server/authoring/approval-preflight.ts"
);
const { resolveAppliedEditingSessionConflict } = await import(
  "../src/server/authoring/applied-session-conflict.ts"
);
const { createValidationOnlyAuthoringDependencies } = await import(
  "../src/ai/authoring/runtime/dependencies.ts"
);
const { canonicalDashboardDocumentFingerprint } = await import(
  "../src/domain/dashboard/document-fingerprint.ts"
);
const { deriveConversationSignalsFromTranscript } = await import(
  "../src/ai/authoring/runtime/transcript-inspection.ts"
);
const { materializeEChartsOptionTemplate } = await import(
  "../src/renderers/echarts/browser/materialize-option.ts"
);
const { resolveViewPresentationContext } = await import(
  "../src/presentation/dashboard/presentation-context.ts"
);
const { resolveDashboardTheme } = await import("../src/presentation/dashboard/themes.ts");
const { validateDashboardDocument } = await import(
  "../src/contracts/validation.ts"
);
const { MAX_REPEAT_FAILURE_ATTEMPTS } = await import(
  "../src/ai/authoring/tools/reliability.ts"
);
const { assertRendererContract } = await import(
  "../src/ai/authoring/tools/stage-chart-resolve.ts"
);

const SALES_SCHEMA: DatasourceContext = {
  datasource_id: "testing-db",
  dialect: "postgres",
  visibility_scope: {
    allowed_tables: ["public.sales_weekly_fact"],
    allowed_fields: [
      "public.sales_weekly_fact.week_start",
      "public.sales_weekly_fact.region",
      "public.sales_weekly_fact.gmv",
      "public.sales_weekly_fact.orders",
    ],
  },
  tables: [
    {
      name: "public.sales_weekly_fact",
      description: "Weekly sales facts.",
      fields: [
        {
          name: "public.sales_weekly_fact.week_start",
          type: "date",
          database_type: "date",
          nullable: false,
          semantic_type: "time",
          filterable: true,
          comment: "Week start date.",
          indexed: true,
        },
        {
          name: "public.sales_weekly_fact.region",
          type: "string",
          database_type: "text",
          nullable: true,
          semantic_type: "dimension",
          filterable: true,
          comment: "Sales region.",
        },
        {
          name: "public.sales_weekly_fact.gmv",
          type: "number",
          database_type: "numeric",
          nullable: false,
          semantic_type: "metric",
          aggregations: ["sum", "avg", "min", "max"],
          comment: "Gross merchandise value.",
        },
        {
          name: "public.sales_weekly_fact.orders",
          type: "number",
          database_type: "integer",
          nullable: false,
          semantic_type: "metric",
          aggregations: ["sum", "avg", "min", "max", "count"],
          comment: "Order count.",
        },
      ],
    },
  ],
};

function baseDocument(): DashboardDocument {
  return {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "purple",
        default_view_style_id: "emphasis",
      },
      dashboard: { name: "Reliability Dashboard" },
      filters: [],
      views: [],
      layout: {
        desktop: { cols: 12, row_height: 80, items: [] },
        mobile: { cols: 4, row_height: 80, items: [] },
      },
    },
    query_defs: [],
    bindings: [],
  };
}

function seededDocument(): DashboardDocument {
  return {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      presentation: {
        design_kit_id: "operational_report",
        color_theme_id: "purple",
        default_view_style_id: "emphasis",
      },
      dashboard: { name: "Reliability Dashboard" },
      filters: [],
      views: [
        {
          id: "v_total_gmv",
          title: "销售总量",
          view_intent: testViewIntent("echarts-kpi-card"),
          renderer: {
            kind: "echarts",
            recipe_id: "echarts-kpi-card",
            option_template: {
              graphic: [
                { type: "text", style: { text: "销售总量" } },
                { type: "text", style: { text: "0" } },
              ],
            },
            slots: [
              {
                id: "value",
                path: "graphic[1].style.text",
                value_kind: "scalar",
                required: true,
              },
            ],
          },
        },
      ],
      layout: {
        desktop: {
          cols: 12,
          row_height: 80,
          items: [{ view_id: "v_total_gmv", x: 0, y: 0, w: 4, h: 3 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ view_id: "v_total_gmv", x: 0, y: 0, w: 4, h: 3 }],
        },
      },
    },
    query_defs: [
      {
        id: "q_total_gmv",
        name: "销售总量",
        datasource_id: "testing-db",
        sql_template: 'select sum("gmv") as "metric_value" from "public"."sales_weekly_fact"',
        params: [],
        output: { kind: "scalar", value_type: "number" },
      },
    ],
    bindings: [
      {
        id: "b_v_total_gmv_value",
        view_id: "v_total_gmv",
        slot_id: "value",
        mode: "live",
        query_id: "q_total_gmv",
        param_mapping: {},
        result_selector: null,
      },
    ],
  };
}

function snapshotWorkingDraft(
  workingDraft: ReturnType<typeof createWorkingDraftState>,
): AuthoringWorkingDraftSnapshot {
  return {
    ...(workingDraft.dashboardSpec ? { dashboardSpec: workingDraft.dashboardSpec } : {}),
    ...(workingDraft.queryDefs ? { queryDefs: workingDraft.queryDefs } : {}),
    ...(workingDraft.bindings ? { bindings: workingDraft.bindings } : {}),
    ...(workingDraft.bindingMode ? { bindingMode: workingDraft.bindingMode } : {}),
    dirtyViewIds: [...workingDraft.dirtyViewIds],
    dirtyQueryIds: [...workingDraft.dirtyQueryIds],
    dirtyBindingIds: [...workingDraft.dirtyBindingIds],
    layoutTouched: workingDraft.layoutTouched,
    ownership: JSON.parse(JSON.stringify(workingDraft.ownership)) as AuthoringWorkingDraftSnapshot["ownership"],
    stagedAt: workingDraft.stagedAt ?? "2026-05-06T00:00:00.000Z",
  };
}

function makeHarness(
  document: DashboardDocument = baseDocument(),
  options: { focusedViewId?: string | null } = {},
) {
  const workingDraft = createWorkingDraftState(null);
  let lastRunCheckState: unknown = null;
  const getDatasourceSchema = async (datasourceId: string) => {
    assert.equal(datasourceId, "testing-db");
    return SALES_SCHEMA;
  };
  const dependencies: AuthoringDependencies = {
    ...createValidationOnlyAuthoringDependencies(),
    executePreview: async (request: PreviewRequest) => ({
      httpStatus: 200,
      body: {
        status_code: 200,
        reason: "OK",
        data: {
          binding_results: Object.fromEntries(
            request.bindings.map((binding) => [
              binding.id,
              {
                view_id: binding.view_id,
                slot_id: binding.slot_id,
                query_id: binding.query_id ?? "unknown",
                status: "ok" as const,
                data: { value: 1 },
              },
            ]),
          ) as BindingResults,
          renderer_checks: {},
        },
      },
    }),
  };
  const buildDraftStatusSnapshot = () => {
    const candidate = buildCandidateDocument(document, workingDraft);
    return buildDraftStatus({
      dashboard: document,
      candidate,
      draft: snapshotWorkingDraft(workingDraft),
      documentHash: buildDocumentFingerprint(candidate),
      lastRunCheckState: lastRunCheckState as never,
    });
  };
  const common = {
    dashboard: document,
    focusedViewId: options.focusedViewId ?? null,
    workingDraft,
    markWorkingDraftUpdated: () => {},
    buildCandidateDocument,
    buildDocumentFingerprint,
    buildDraftStatus: buildDraftStatusSnapshot,
  };
  return {
    workingDraft,
    stageChart: buildStageChartTool({
      ...common,
      checks: null,
      getDatasourceSchema,
    }),
    stageViewIntent: buildStageViewIntentTool({
      ...common,
      checks: null,
      getDatasourceSchema,
    }),
    stageReplaceChart: buildStageReplaceChartTool({
      ...common,
      checks: null,
      getDatasourceSchema,
    }),
    stageDelete: buildStageDeleteTool(common),
    runCheck: buildRunCheckTool({
      ...common,
      checks: null,
      dependencies,
      getLastRunCheckState: () => lastRunCheckState as never,
      setLastRunCheckState: (value) => {
        lastRunCheckState = value;
      },
    }),
    composePatch: buildComposePatchTool({
      ...common,
      dependencies,
      getLastRunCheckState: () => lastRunCheckState as never,
      setLatestProposalMeta: () => {},
      getBaseVersion: () => 2,
    }),
    candidate: () => buildCandidateDocument(document, workingDraft),
    draftStatus: buildDraftStatusSnapshot,
    lastRunCheckState: () => lastRunCheckState as AuthoringRunCheckStateSnapshot | null,
  };
}

function makeSession(overrides = {}) {
  return new AuthoringAgentSession({
    dashboard: baseDocument(),
    dependencies: createValidationOnlyAuthoringDependencies(),
    promptText: "Create a sales chart",
    sessionId: "sess_test",
    turnId: "turn_test",
    ...overrides,
  });
}

type PiToolForTest = {
  name: string;
  prepareArguments?: (args: unknown) => unknown;
  execute: (toolCallId: string, params: unknown) => Promise<{ details: unknown }>;
};

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function pendingPatchTranscript(input: {
  proposalId?: string;
  baseVersion?: number;
  draftFingerprint?: string;
  baseDocumentFingerprint?: string;
  expiresAt?: number;
} = {}) {
  const proposalId = input.proposalId ?? "patch-1";
  return [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_compose_patch",
          name: "composePatch",
          arguments: {},
        },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4.1-mini",
      usage: zeroUsage(),
      stopReason: "toolUse",
      timestamp: 1,
    },
    {
      role: "toolResult",
      toolCallId: "call_compose_patch",
      toolName: "composePatch",
      content: [{ type: "text", text: "Patch composed." }],
      details: {
        base_version: input.baseVersion ?? 7,
        base_document_fingerprint: input.baseDocumentFingerprint,
        draft_fingerprint: input.draftFingerprint ?? "draft_fp_1",
        expires_at: input.expiresAt ?? Date.now() + 60_000,
        suggestion: {
          id: proposalId,
          kind: "layout",
          title: "Patch",
          summary: "Patch summary",
          details: [],
          patch: {
            summary: "Patch summary",
            operations: [
              {
                op: "replace",
                path: "dashboard_spec.dashboard.name",
                value: "Updated dashboard",
              },
            ],
          },
          dashboard: baseDocument(),
        },
      },
      isError: false,
      timestamp: 2,
    },
  ];
}

function applyPatchTranscript(input: {
  suggestionId?: string;
  timestamp?: number;
} = {}) {
  const suggestionId = input.suggestionId ?? "patch-1";
  return [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: `call_apply_${suggestionId}`,
          name: "applyPatch",
          arguments: {},
        },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4.1-mini",
      usage: zeroUsage(),
      stopReason: "toolUse",
      timestamp: input.timestamp ?? 3,
    },
    {
      role: "toolResult",
      toolCallId: `call_apply_${suggestionId}`,
      toolName: "applyPatch",
      content: [{ type: "text", text: "Patch applied." }],
      details: {
        applied: true,
        suggestion_id: suggestionId,
        kind: "layout",
        title: "Patch",
        summary: "Applied patch.",
        patch_summary: "Patch summary",
        dashboard: baseDocument(),
      },
      isError: false,
      timestamp: (input.timestamp ?? 3) + 1,
    },
  ];
}

function stagedGmvDraftSnapshot(): AuthoringWorkingDraftSnapshot {
  const staged = seededDocument();
  return {
    dashboardSpec: staged.dashboard_spec,
    queryDefs: staged.query_defs,
    bindings: staged.bindings,
    bindingMode: "live",
    dirtyViewIds: ["v_total_gmv"],
    dirtyQueryIds: ["q_total_gmv"],
    dirtyBindingIds: ["b_v_total_gmv_value"],
    layoutTouched: true,
    stagedAt: "2026-05-06T00:00:00.000Z",
  };
}

async function executeTool<T>(toolInstance: unknown, input: unknown): Promise<T> {
  const execute = (toolInstance as { execute?: (input: unknown) => Promise<T> }).execute;
  assert.equal(typeof execute, "function");
  return execute!(input);
}

function validToolInputs(): Record<string, Record<string, unknown>> {
  return {
    declareAuthoringGoal: { kind: "set_data_mode", dataMode: "live" },
    loadSkill: { name: "echarts-kpi-text" },
    getViews: {},
    getDatasources: {},
    getView: {},
    getQuery: { query_id: "q_total_gmv" },
    getBinding: { view_id: "v_total_gmv" },
    getDraftStatus: {},
    listDatasourceTables: { datasource_id: "testing-db" },
    getTableSchema: { datasource_id: "testing-db", table: "sales_weekly_fact" },
    previewTableData: { datasource_id: "testing-db", table: "sales_weekly_fact" },
    runCheck: { scope: "view", view_id: "v_total_gmv" },
    stageChart: {
      skill_id: "echarts-kpi-text",
      title: "销售总量",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: { value: { source_field: "gmv", aggregation: "sum" } },
    },
    stageViewIntent: {
      view_kind: "stat_kpi",
      title: "销售总量",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: { value: { source_field: "gmv", aggregation: "sum" } },
    },
    stageReplaceChart: {
      replace_view_id: "v_total_gmv",
      skill_id: "echarts-kpi-text",
      title: "销售总量",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: { value: { source_field: "gmv", aggregation: "sum" } },
    },
    stageQuery: { query_id: "q_total_gmv", sql: "select sum(gmv) as gmv from public.sales_weekly_fact", reason: "add computed metric" },
    stageDelete: { target: { kind: "view", view_id: "v_total_gmv" } },
    composePatch: {},
    applyPatch: {},
  };
}

test("schema tools expose table summaries and field-level metadata", async () => {
  const listTool = buildListDatasourceTablesTool({
    getDatasourceSchema: async () => SALES_SCHEMA,
  });
  const schemaTool = buildGetTableSchemaTool({
    getDatasourceSchema: async () => SALES_SCHEMA,
  });

  const tables = await executeTool<Record<string, unknown>>(listTool, {
    datasource_id: "testing-db",
  });
  assert.equal(tables.table_count, 1);
  assert.deepEqual((tables.tables as Array<{ name: string }>).map((table) => table.name), [
    "public.sales_weekly_fact",
  ]);

  const schema = await executeTool<{
    table: { name: string };
    fields: Array<{ name: string; standard_type: string; comment?: string; available_aggregations?: string[] }>;
  }>(schemaTool, {
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
  });
  assert.equal(schema.table.name, "public.sales_weekly_fact");
  assert.deepEqual(schema.fields.map((field) => field.name), [
    "week_start",
    "region",
    "gmv",
    "orders",
  ]);
  assert.equal(schema.fields.find((field) => field.name === "gmv")?.standard_type, "number");
  assert.equal(schema.fields.find((field) => field.name === "gmv")?.comment, "Gross merchandise value.");
  assert.deepEqual(
    schema.fields.find((field) => field.name === "gmv")?.available_aggregations,
    ["sum", "avg", "min", "max"],
  );
});

test("schema result formatting makes missing field metadata visible in logs", async () => {
  const schema = await executeTool(
    buildGetTableSchemaTool({ getDatasourceSchema: async () => SALES_SCHEMA }),
    { datasource_id: "testing-db", table: "sales_weekly_fact" },
  );
  const text = formatAuthoringToolResultText("getTableSchema", schema);

  assert.match(text, /Table schema loaded/);
  assert.match(text, /field_count: 4/);
  assert.match(text, /gmv/);
  assert.match(text, /Gross merchandise value/);
});

test("previewTableData is separate from schema and builds a limited read-only preview", async () => {
  const previewRequest: { current: PreviewRequest | null } = { current: null };
  const previewTool = buildPreviewTableDataTool({
    getDatasourceSchema: async () => SALES_SCHEMA,
    executePreview: async (request) => {
      previewRequest.current = request;
      return {
        httpStatus: 200,
        body: {
          status_code: 200,
          reason: "ok",
          data: {
            renderer_checks: {},
            binding_results: {
              __preview_table_data_binding: {
                view_id: "__preview_table_data_view",
                slot_id: "rows",
                query_id: "__preview_table_data_query",
                status: "ok",
                data: { value: null, rows: [{ region: "East", gmv: 1234 }] },
              },
            },
          },
        },
      };
    },
  });

  const result = await executeTool<{
    columns: string[];
    limit: number;
    row_count: number;
    rows: Array<Record<string, unknown>>;
  }>(previewTool, {
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    columns: ["region", "gmv"],
    limit: 3,
  });

  assert.deepEqual(result.columns, ["region", "gmv"]);
  assert.equal(result.limit, 3);
  assert.equal(result.row_count, 1);
  assert.equal(result.rows[0]?.gmv, 1234);
  assert.ok(previewRequest.current);
  assert.match(previewRequest.current.query_defs[0]?.sql_template ?? "", /limit 3$/i);
});

test("loaded table schema persists into compact authoring context after transcript trim", async () => {
  const schema = await executeTool(
    buildGetTableSchemaTool({ getDatasourceSchema: async () => SALES_SCHEMA }),
    { datasource_id: "testing-db", table: "sales_weekly_fact" },
  );
  const messages = [
    {
      role: "assistant",
      content: "",
      toolCalls: [{ toolCallId: "call_schema", toolName: "getTableSchema" }],
      timestamp: 1,
    },
    {
      role: "toolResult",
      toolCallId: "call_schema",
      toolName: "getTableSchema",
      content: [{ type: "text", text: "schema" }],
      details: schema,
      isError: false,
      timestamp: 2,
    },
    { role: "user", content: "继续", timestamp: 3 },
  ];
  const facts = deriveAuthoringFacts({ messages: messages as never });
  const block = buildAuthoringContextBlock({
    variant: "dashboard",
    dashboard: baseDocument(),
    datasources: [{ datasource_id: "testing-db", label: "testing-db" }],
    draftStatus: makeHarness().draftStatus(),
    facts,
  });
  const transformed = transformAuthoringContext({
    messages: messages as never,
    contextMarkdown: block.markdown,
    maxMessages: 1,
  });
  const serialized = JSON.stringify(transformed);

  assert.match(serialized, /loaded_table_schemas/);
  assert.match(serialized, /week_start/);
  assert.match(serialized, /orders/);
});

test("stageChart creates KPI transaction from field intent without model SQL", async () => {
  const harness = makeHarness();
  const result = await executeTool<{
    artifact_ids: { view_id: string; query_id?: string; binding_ids: string[] };
    draft_status: { missing_required_bindings: unknown[]; blockers: string[] };
  }>(harness.stageChart, {
    skill_id: "echarts-kpi-text",
    title: "销售总量",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });
  const candidate = harness.candidate();

  assert.equal(candidate.dashboard_spec.views.length, 1);
  assert.equal(candidate.query_defs.length, 1);
  assert.equal(candidate.bindings.length, 1);
  assert.match(candidate.query_defs[0]?.sql_template ?? "", /sum\("gmv"\)/i);
  assert.deepEqual(result.draft_status.missing_required_bindings, []);
  assert.equal(result.draft_status.blockers.includes("missing_required_bindings"), false);
  assert.equal(result.draft_status.blockers.includes("stale_check"), true);
  assert.equal(result.artifact_ids.binding_ids.length, 1);

  const resultText = formatAuthoringToolResultText("stageChart", result);
  assert.match(resultText, /artifact_view_id:/);
  assert.match(resultText, /draft_blockers: stale_check/);
});

test("stageViewIntent creates stat KPI transaction without exposing recipe ids", async () => {
  const harness = makeHarness();
  const result = await executeTool<{
    artifact_ids: { view_id: string; query_id?: string; binding_ids: string[] };
    draft_status: { missing_required_bindings: unknown[]; blockers: string[] };
  }>(harness.stageViewIntent, {
    view_kind: "stat_kpi",
    title: "销售总额",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });
  const candidate = harness.candidate();
  const view = candidate.dashboard_spec.views[0];

  assert.equal(view?.view_intent.view_kind, "stat_kpi");
  assert.equal(view?.renderer.recipe_id, "echarts-kpi-card");
  assert.equal(candidate.query_defs.length, 1);
  assert.equal(candidate.bindings.length, 1);
  assert.equal(
    (candidate.dashboard_spec.layout.desktop?.items ?? []).some(
      (item) => item.view_id === result.artifact_ids.view_id,
    ),
    true,
  );
  assert.equal(
    (candidate.dashboard_spec.layout.mobile?.items ?? []).some(
      (item) => item.view_id === result.artifact_ids.view_id,
    ),
    true,
  );
  assert.equal(result.artifact_ids.binding_ids.length, 1);
  assert.equal(result.draft_status.blockers.includes("missing_required_bindings"), false);
});

test("stageViewIntent schema rejects renderer implementation fields", () => {
  assert.throws(
    () =>
      Value.Parse(stageViewIntentInputSchema, {
        view_kind: "stat_kpi",
        skill_id: "echarts-kpi-card",
        recipe_id: "echarts-kpi-card",
        renderer: { kind: "echarts" },
        layout: { desktop: { w: 3, h: 2 } },
        view_style_id: "standard",
        title: "销售总额",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        fields: { value: { source_field: "gmv", aggregation: "sum" } },
      }),
  );
});

test("stageChart rejects legacy KPI text for executive report dashboards", async () => {
  const dashboard = baseDocument();
  dashboard.dashboard_spec.presentation = {
    design_kit_id: "executive_report",
    color_theme_id: "purple",
    default_view_style_id: "emphasis",
  };
  const harness = makeHarness(dashboard);

  await assert.rejects(
    executeTool(harness.stageChart, {
      skill_id: "echarts-kpi-text",
      title: "订单数",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: { value: { source_field: "orders", aggregation: "sum" } },
    }),
    /unsupported_design_kit_recipe: echarts-kpi-text is not supported for executive_report.*echarts-kpi-card/i,
  );
});

test("stageChart target_view_id wins over focused view for explicit revisions", async () => {
  const harness = makeHarness(seededDocument(), { focusedViewId: "v_total_gmv" });
  const result = await executeTool<{
    artifact_ids: { view_id: string };
  }>(harness.stageChart, {
    skill_id: "echarts-kpi-text",
    title: "订单总量",
    target_view_id: "v_orders",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "orders", aggregation: "sum" } },
  });

  assert.equal(result.artifact_ids.view_id, "v_orders");
  assert.ok(harness.candidate().dashboard_spec.views.some((view) => view.id === "v_orders"));
});

test("stageChart mock KPI bindings satisfy document validation", async () => {
  const harness = makeHarness();
  await executeTool(harness.stageChart, {
    skill_id: "echarts-kpi-text",
    title: "模拟订单总量",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: { value: { source_field: "orders", aggregation: "sum" } },
    mock_value: 42,
  });

  const candidate = harness.candidate();
  const binding = candidate.bindings[0];
  assert.equal(binding?.mode, "mock");
  assert.deepEqual(binding?.mock_data?.rows, [{ metric_value: 42 }]);
  assert.equal(binding?.mock_value, 42);

  const validation = validateDashboardDocument(candidate, "save");
  assert.equal(
    validation.ok,
    true,
    validation.ok ? undefined : JSON.stringify(validation.issues),
  );
});

test("stageChart mock bar bindings use slot-shaped mock values", async () => {
  const harness = makeHarness();
  await executeTool(harness.stageChart, {
    skill_id: "echarts-bar",
    title: "模拟区域 GMV",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: {
      category: { source_field: "region" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  });

  const candidate = harness.candidate();
  const categoryBinding = candidate.bindings.find((binding) => binding.slot_id === "category");
  const valueBinding = candidate.bindings.find((binding) => binding.slot_id === "value");

  assert.deepEqual(categoryBinding?.mock_value, ["Sample A", "Sample B", "Sample C"]);
  assert.deepEqual(valueBinding?.mock_value, [120, 156, 194]);
});

test("stageChart mock rows include category names for ECharts rows recipes", async () => {
  const harness = makeHarness();
  await executeTool(harness.stageChart, {
    skill_id: "echarts-signal-list",
    title: "模拟运营信号",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    data_mode: "mock",
    fields: {
      category: { source_field: "region" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  });

  const candidate = harness.candidate();
  const rowsBinding = candidate.bindings.find((binding) => binding.slot_id === "rows");

  assert.equal(rowsBinding?.mode, "mock");
  assert.deepEqual(
    rowsBinding?.mock_data?.rows.map((row) => row.category_name),
    ["Sample A", "Sample B"],
  );
  assert.equal(
    Array.isArray(rowsBinding?.mock_value) &&
      typeof rowsBinding.mock_value[0] === "object" &&
      rowsBinding.mock_value[0] !== null &&
      !Array.isArray(rowsBinding.mock_value[0])
      ? rowsBinding.mock_value[0].category_name
      : undefined,
    "Sample A",
  );
});

test("draft status keeps failed checks recoverable until repeat budget is exhausted", async () => {
  const harness = makeHarness();
  await executeTool(harness.stageChart, {
    skill_id: "echarts-kpi-text",
    title: "销售总量",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });

  const candidate = harness.candidate();
  const documentHash = buildDocumentFingerprint(candidate);
  const draft = snapshotWorkingDraft(harness.workingDraft);
  const failedOnce = buildDraftStatus({
    dashboard: baseDocument(),
    candidate,
    draft,
    documentHash,
    lastRunCheckState: {
      fingerprint: documentHash,
      signatures: ["renderer_error"],
      consecutiveRepeatCount: Math.max(0, MAX_REPEAT_FAILURE_ATTEMPTS - 1),
    },
  });

  assert.equal(failedOnce.can_compose, false);
  assert.deepEqual(failedOnce.blockers, ["stale_check"]);

  const exhausted = buildDraftStatus({
    dashboard: baseDocument(),
    candidate,
    draft,
    documentHash,
    lastRunCheckState: {
      fingerprint: documentHash,
      signatures: ["renderer_error"],
      consecutiveRepeatCount: MAX_REPEAT_FAILURE_ATTEMPTS,
    },
  });

  assert.equal(exhausted.can_compose, false);
  assert.deepEqual(exhausted.blockers, []);
});

test("runCheck rejects invalid scope arguments with explicit diagnostics", () => {
  const harness = makeHarness();
  const piRunCheck = toPiAgentTool("runCheck", harness.runCheck as never);
  const prepare = piRunCheck.prepareArguments;
  assert.equal(typeof prepare, "function");
  if (!prepare) {
    throw new Error("runCheck prepareArguments was not installed.");
  }

  assert.throws(
    () => prepare({ scope: "draft" }),
    /Invalid runCheck\.scope: expected "dashboard" or "view"; received "draft"/,
  );
  assert.throws(
    () => prepare({ scope: "staged" }),
    /Invalid runCheck\.scope: expected "dashboard" or "view"; received "staged"/,
  );
  assert.throws(
    () => prepare({ scope: "current" }),
    /Invalid runCheck\.scope: expected "dashboard" or "view"; received "current"/,
  );
  assert.throws(
    () => prepare({ scope: "view" }),
    /Invalid runCheck\.view_id: view_id is required when scope is "view"/,
  );
  assert.throws(
    () => prepare({ scope: { kind: "view" }, view_id: "v_1" }),
    /Invalid runCheck\.scope: expected "dashboard" or "view"; received object/,
  );
});

test("pi tool adapter forwards label, prepareArguments, and executionMode", () => {
  const harness = makeHarness();
  const piRunCheck = toPiAgentTool("runCheck", harness.runCheck as never);
  const piStageChart = toPiAgentTool("stageChart", harness.stageChart as never);

  assert.equal(piRunCheck.label, "Run Check");
  assert.equal(typeof piRunCheck.prepareArguments, "function");
  assert.equal(piRunCheck.executionMode, "sequential");
  assert.equal(piStageChart.label, "Stage Chart");
  assert.equal(piStageChart.executionMode, "sequential");
});

test("all authoring tool schemas reject unknown root parameters", () => {
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: seededDocument(),
    datasources: [{ datasource_id: "testing-db", label: "Testing DB" }],
    skills: [
      {
        id: "echarts-kpi-text",
        name: "KPI Text",
        description: "KPI text card",
        path: "/skills/echarts-kpi-text/SKILL.md",
      },
    ],
    dependencies: createValidationOnlyAuthoringDependencies(),
  });
  const validInputs = validToolInputs();
  const tools = runtime.getTools();

  for (const registration of AUTHORING_TOOL_REGISTRY) {
    const tool = tools[registration.name];
    const validInput = validInputs[registration.name];
    assert.ok(tool, `missing tool definition for ${registration.name}`);
    assert.ok(validInput, `missing valid schema fixture for ${registration.name}`);
    assert.equal(
      Value.Check(tool.parameters, validInput),
      true,
      `${registration.name} fixture should be valid`,
    );
    assert.equal(
      Value.Check(tool.parameters, { ...validInput, __unexpected: true }),
      false,
      `${registration.name} should reject unknown root keys`,
    );
  }
});

test("stageChart, runCheck, and composePatch complete the approval proposal flow", async () => {
  const harness = makeHarness();
  const staged = await executeTool<{
    artifact_ids: { view_id: string; query_id?: string; binding_ids: string[] };
  }>(harness.stageChart, {
    skill_id: "echarts-kpi-text",
    title: "销售总量",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });

  const check = await executeTool<{ status: string; failures: unknown[] }>(harness.runCheck, {
    scope: "view",
    view_id: staged.artifact_ids.view_id,
  });
  assert.equal(check.status, "ok");
  assert.equal(check.failures.length, 0);

  const patch = await executeTool<{
    suggestion: { id: string; dashboard: DashboardDocument };
    base_version?: number;
    expires_at: number;
  }>(harness.composePatch, { reason: "Compose approval proposal after fresh check." });
  assert.match(patch.suggestion.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(patch.base_version, 2);
  assert.equal(typeof patch.expires_at, "number");
  assert.ok(patch.expires_at > Date.now());
  assert.equal(patch.suggestion.dashboard.dashboard_spec.views.length, 1);
});

test("stageChart supports report ECharts builders through runtime SQL generation", async () => {
  const cases = [
    {
      skill_id: "echarts-line",
      title: "GMV 趋势",
      fields: {
        time: { source_field: "week_start" },
        metric: { source_field: "gmv", aggregation: "sum" },
      },
      sql: /group by 1.*order by 1 asc/i,
    },
    {
      skill_id: "echarts-line",
      title: "区域 GMV 周趋势",
      fields: {
        time: { source_field: "week_start" },
        metric: { source_field: "gmv", aggregation: "sum" },
        series: { source_field: "region" },
      },
      sql: /group by 1, 2.*order by 1 asc/i,
      multiSeries: true,
    },
    {
      skill_id: "echarts-bar",
      title: "区域 GMV",
      fields: {
        category: { source_field: "region" },
        metric: { source_field: "gmv", aggregation: "sum" },
      },
      sql: /order by 2 desc.*limit 10/i,
    },
    {
      skill_id: "echarts-kpi-text",
      title: "订单总量",
      fields: { value: { source_field: "orders", aggregation: "sum" } },
      sql: /select sum\("orders"\)/i,
    },
    {
      skill_id: "echarts-kpi-gauge",
      title: "订单均值",
      fields: { value: { source_field: "orders", aggregation: "avg" } },
      sql: /select avg\("orders"\)/i,
    },
    {
      skill_id: "echarts-kpi-card",
      title: "GMV 卡片",
      fields: { value: { source_field: "gmv", aggregation: "sum" } },
      sql: /select sum\("gmv"\)/i,
    },
    {
      skill_id: "echarts-signal-list",
      title: "运营信号",
      fields: {
        category: { source_field: "region" },
        metric: { source_field: "gmv", aggregation: "sum" },
      },
      sql: /select "region" as "category_name", sum\("gmv"\) as "metric_value".*order by 2 desc.*limit 10/i,
      rowsRecipe: true,
    },
    {
      skill_id: "echarts-funnel",
      title: "区域漏斗",
      fields: {
        category: { source_field: "region" },
        metric: { source_field: "orders", aggregation: "sum" },
      },
      sql: /select "region" as "category_name", sum\("orders"\) as "metric_value".*order by 2 desc.*limit 10/i,
      rowsRecipe: true,
    },
    {
      skill_id: "echarts-ranked-bar",
      title: "区域明细",
      fields: {
        category: { source_field: "region" },
        metric: { source_field: "gmv", aggregation: "sum" },
      },
      sql: /select "region" as "category_name", sum\("gmv"\) as "metric_value".*order by 2 desc.*limit 10/i,
      rowsRecipe: true,
    },
  ];

  for (const chart of cases) {
    const harness = makeHarness();
    await executeTool(harness.stageChart, {
      ...chart,
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
    });
    const candidate = harness.candidate();
    assert.match(candidate.query_defs[0]?.sql_template ?? "", chart.sql);
    assert.equal(candidate.bindings.length > 0, true);
    if ("rowsRecipe" in chart) {
      assert.equal(candidate.bindings[0]?.result_selector, "rows");
    }

    if ("multiSeries" in chart) {
      const renderer = candidate.dashboard_spec.views[0]?.renderer;
      assert.deepEqual(renderer?.transforms?.map((transform) => transform.kind), [
        "pivot_rows",
        "generate_series",
      ]);
      assert.equal(
        Object.prototype.hasOwnProperty.call(renderer?.slots[0] ?? {}, "series_key_field"),
        false,
      );
      assert.equal(candidate.bindings[0]?.result_selector, "rows");
    }
  }
});

test("stageChart stores theme-tokenized ECharts options for the dashboard theme", async () => {
  const document = baseDocument();
  document.dashboard_spec.presentation = {
    design_kit_id: "operational_report",
    color_theme_id: "teal",
    default_view_style_id: "emphasis",
  };
  const harness = makeHarness(document);
  await executeTool(harness.stageChart, {
    skill_id: "echarts-bar",
    title: "区域 GMV",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: {
      category: { source_field: "region" },
      metric: { source_field: "gmv", aggregation: "sum" },
    },
  });

  const candidate = harness.candidate();
  const renderer = candidate.dashboard_spec.views[0]?.renderer;
  assert.ok(renderer);
  const option = materializeEChartsOptionTemplate({
    template: renderer.option_template,
    slots: renderer.slots,
    transforms: renderer.transforms,
    presentation: resolveViewPresentationContext(candidate).chartPresentation,
    bindingResults: [],
  }) as { color: string[]; series: Array<{ itemStyle: { color: string } }> };

  assert.equal(option.color[0], resolveDashboardTheme("teal").chart.primary);
  assert.equal(option.series[0]?.itemStyle.color, resolveDashboardTheme("teal").chart.primary);
});

test("ECharts renderer transforms pivot long rows and generate dynamic line series", () => {
  const rows = [
    { time_value: "2026-01-05", series_value: "East", metric_value: 10 },
    { time_value: "2026-01-05", series_value: "West", metric_value: 20 },
    { time_value: "2026-01-12", series_value: "East", metric_value: 15 },
  ];

  const option = materializeEChartsOptionTemplate({
    template: {
      dataset: { source: [] },
      series: [],
    },
    slots: [
      {
        id: "dataset",
        path: "dataset.source",
        value_kind: "rows",
        required: true,
      },
    ],
    transforms: [
      {
        id: "pivot_dataset",
        kind: "pivot_rows",
        source_slot: "dataset",
        row_key: "time_value",
        column_key: "series_value",
        value_field: "metric_value",
        target_path: "dataset.source",
      },
      {
        id: "dynamic_series",
        kind: "generate_series",
        source_transform: "pivot_dataset",
        target_path: "series",
        series_type: "line",
        encode_x: "time_value",
        defaults: { smooth: true, showSymbol: false },
      },
    ],
    bindingResults: [
      {
        slot_id: "dataset",
        result: {
          view_id: "v_trend",
          slot_id: "dataset",
          query_id: "q_trend",
          status: "ok",
          data: { value: rows, rows },
        },
      },
    ],
  });

  const dataset = option.dataset as { source: unknown[][] };
  assert.deepEqual(dataset.source, [
    ["time_value", "East", "West"],
    ["2026-01-05", 10, 20],
    ["2026-01-12", 15, null],
  ]);
  const series = option.series as Array<{
    type?: string;
    name?: string;
    encode?: Record<string, string>;
    symbolSize?: number;
    areaStyle?: unknown;
  }>;
  assert.deepEqual(
    series.map((entry) => ({
      type: entry.type,
      name: entry.name,
      encode: entry.encode,
    })),
    [
      { type: "line", name: "East", encode: { x: "time_value", y: "East" } },
      { type: "line", name: "West", encode: { x: "time_value", y: "West" } },
    ],
  );
  assert.equal(series[0]?.symbolSize, 7);
  assert.ok(series[0]?.areaStyle);
});

test("ECharts renderer transform materialization fails on missing transform dependencies", () => {
  assert.throws(
    () =>
      materializeEChartsOptionTemplate({
        template: {
          dataset: { source: [] },
          series: [],
        },
        slots: [
          {
            id: "dataset",
            path: "dataset.source",
            value_kind: "rows",
            required: true,
          },
        ],
        transforms: [
          {
            id: "dynamic_series",
            kind: "generate_series",
            source_transform: "missing_pivot",
            target_path: "series",
            series_type: "line",
            encode_x: "time_value",
          },
        ],
        bindingResults: [],
      }),
    /references missing source_transform "missing_pivot"/,
  );
});

test("contract validation rejects removed slot transforms and validates transform fields", () => {
  const removedTransformDocument: DashboardDocument = {
    ...baseDocument(),
    dashboard_spec: {
      ...baseDocument().dashboard_spec,
      views: [
        {
          id: "v_removed_transform",
          title: "Removed transform",
          view_intent: testViewIntent("echarts-bar"),
          renderer: {
            kind: "echarts",
            recipe_id: "echarts-bar",
            option_template: { dataset: { source: [] }, series: [] },
            slots: [
              {
                id: "dataset",
                path: "dataset.source",
                value_kind: "rows",
                required: true,
                series_key_field: "series_value",
              } as never,
            ],
          },
        },
      ],
    },
  };

  const removedTransformResult = validateDashboardDocument(removedTransformDocument, "save");
  assert.equal(removedTransformResult.ok, false);
  assert.equal(
    removedTransformResult.issues.some(
      (issue) =>
        issue.path === "dashboard_spec.views[0].renderer.slots[0].series_key_field" &&
        issue.message ===
          "slot-level renderer transforms are not supported; use renderer.transforms",
    ),
    true,
  );

  const transformDocument: DashboardDocument = {
    schema_version: "1.0",
    dashboard_spec: {
      ...baseDocument().dashboard_spec,
      views: [
        {
          id: "v_trend",
          title: "Trend",
          view_intent: testViewIntent("echarts-bar"),
          renderer: {
            kind: "echarts",
            recipe_id: "echarts-bar",
            option_template: { dataset: { source: [] }, series: [] },
            slots: [
              { id: "dataset", path: "dataset.source", value_kind: "rows", required: true },
            ],
            transforms: [
              {
                id: "pivot_dataset",
                kind: "pivot_rows",
                source_slot: "dataset",
                row_key: "time_value",
                column_key: "series_value",
                value_field: "metric_value",
                target_path: "dataset.source",
              },
              {
                id: "dynamic_series",
                kind: "generate_series",
                source_transform: "pivot_dataset",
                target_path: "series",
                series_type: "line",
                encode_x: "time_value",
              },
            ],
          },
        },
      ],
    },
    query_defs: [
      {
        id: "q_bad",
        name: "Bad",
        datasource_id: "testing-db",
        sql_template: "select week_start as time_value from sales_weekly_fact",
        params: [],
        output: {
          kind: "rows",
          schema: [
            { name: "time_value", type: "date", nullable: true },
            { name: "metric_value", type: "string", nullable: true },
          ],
        },
      },
    ],
    bindings: [
      {
        id: "b_bad",
        view_id: "v_trend",
        slot_id: "dataset",
        mode: "live",
        query_id: "q_bad",
        param_mapping: {},
        result_selector: "rows",
      },
    ],
  };

  const transformResult = validateDashboardDocument(transformDocument, "save");
  assert.equal(transformResult.ok, false);
  const messages = transformResult.issues.map((issue) => issue.message).join("\n");
  assert.match(messages, /unknown result field series_value/);
  assert.match(messages, /value_field must reference a number result field/);
});

test("contract validation and stageChart assertions reject invalid transform kind ordering", () => {
  const invalidTransformDocument: DashboardDocument = {
    ...baseDocument(),
    dashboard_spec: {
      ...baseDocument().dashboard_spec,
      views: [
        {
          id: "v_bad_kind",
          title: "Bad Kind",
          view_intent: testViewIntent("echarts-bar"),
          renderer: {
            kind: "echarts",
            recipe_id: "echarts-bar",
            option_template: { dataset: { source: [] }, series: [] },
            slots: [
              { id: "dataset", path: "dataset.source", value_kind: "rows", required: true },
            ],
            transforms: [
              {
                id: "not_a_real_transform",
                kind: "unknown_transform",
                target_path: "dataset.source",
              } as never,
              {
                id: "dynamic_series",
                kind: "generate_series",
                source_transform: "not_a_real_transform",
                target_path: "series",
                series_type: "line",
                encode_x: "time_value",
              },
            ],
          },
        },
      ],
    },
  };

  const validation = validateDashboardDocument(invalidTransformDocument, "save");
  assert.equal(validation.ok, false);
  const issues = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
  assert.match(issues, /renderer\.transforms\[0\]\.kind: renderer transform kind must be pivot_rows or generate_series/);
  assert.match(issues, /renderer\.transforms\[1\]\.source_transform: generate_series source_transform must reference an earlier renderer transform/);

  assert.throws(
    () =>
      assertRendererContract(
        [{ id: "dataset", path: "dataset.source", value_kind: "rows", required: true }],
        { dataset: { source: [] }, series: [] },
        [
          {
            id: "not_a_real_transform",
            kind: "unknown_transform",
            target_path: "dataset.source",
          } as never,
        ],
      ),
    /kind must be pivot_rows or generate_series/,
  );
});

test("stageChart is atomic on missing fields and leaves no partial draft", async () => {
  const harness = makeHarness();
  await assert.rejects(
    () =>
      executeTool(harness.stageChart, {
        skill_id: "echarts-kpi-text",
        title: "坏字段",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        fields: { value: { source_field: "missing_metric", aggregation: "sum" } },
      }),
    /Available fields: week_start, region, gmv, orders/,
  );

  const candidate = harness.candidate();
  assert.equal(candidate.dashboard_spec.views.length, 0);
  assert.equal(candidate.query_defs.length, 0);
  assert.equal(candidate.bindings.length, 0);
});

test("stageChart retry reuses deterministic artifact ids", async () => {
  const harness = makeHarness();
  const input = {
    skill_id: "echarts-kpi-text",
    title: "销售总量",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  };
  const first = await executeTool<{ artifact_ids: { view_id: string; query_id?: string; binding_ids: string[] } }>(
    harness.stageChart,
    input,
  );
  const second = await executeTool<{ artifact_ids: { view_id: string; query_id?: string; binding_ids: string[] } }>(
    harness.stageChart,
    input,
  );

  assert.deepEqual(second.artifact_ids, first.artifact_ids);
  assert.equal(harness.candidate().dashboard_spec.views.length, 1);
  assert.equal(harness.candidate().query_defs.length, 1);
  assert.equal(harness.candidate().bindings.length, 1);
});

test("stageChart schema rejects SQL and QueryDef output in public input", () => {
  assert.throws(() =>
    Value.Parse(stageChartInputSchema, {
      skill_id: "echarts-line",
      title: "GMV trend",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: {
        time: { source_field: "week_start" },
        metric: { source_field: "gmv" },
      },
      query: {
        sql_template: "select * from sales_weekly_fact",
        output: { kind: "rows", schema: [] },
      },
    }),
  );
});

test("adapter normalizes schema argument errors with tool contract context", () => {
  const harness = makeHarness();
  const piStageChart = toPiAgentTool("stageChart", harness.stageChart as never);
  const prepare = piStageChart.prepareArguments;
  assert.equal(typeof prepare, "function");
  if (!prepare) {
    throw new Error("stageChart prepareArguments was not installed.");
  }

  assert.throws(
    () =>
      prepare({
        skill_id: "echarts-line",
        title: "GMV trend",
        datasource_id: "testing-db",
        table: "sales_weekly_fact",
        fields: {
          time: { source_field: "week_start" },
          metric: { source_field: "gmv" },
        },
        query: {
          sql_template: "select * from sales_weekly_fact",
          output: { kind: "rows", schema: [] },
        },
      }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Invalid stageChart arguments:/);
      assert.match(message, /Contract:/);
      assert.match(message, /do not provide: SQL, QueryDef\.output, renderer\.option_template/);
      assert.doesNotMatch(message, /anyOf/i);
      return true;
    },
  );
});

test("authoring surface exposes transaction tools and removes low-level upsert/delete tools", () => {
  const canonicalNames = AUTHORING_TOOL_REGISTRY.map((definition) => definition.name);
  for (const oldName of [
    "getSchemaByDatasource",
    "upsertQuery",
    "upsertView",
    "upsertBinding",
    "upsertLayout",
    "deleteView",
    "deleteQuery",
    "deleteBinding",
  ]) {
    assert.equal(canonicalNames.includes(oldName as never), false);
  }
  for (const newName of [
    "listDatasourceTables",
    "getTableSchema",
    "previewTableData",
    "stageChart",
    "stageViewIntent",
    "stageReplaceChart",
    "stageDelete",
  ]) {
    assert.equal(canonicalNames.includes(newName as never), true);
  }

  const surface = buildAuthorToolSurface({
    scope: { kind: "dashboard" },
    allowedTools: canonicalNames as never,
  });
  assert.equal(surface.activeTools.includes("stageChart"), true);
  assert.equal(surface.activeTools.includes("stageViewIntent"), true);
  assert.equal(surface.activeTools.includes("stageReplaceChart"), true);
  assert.equal(surface.activeTools.includes("stageDelete"), true);
  assert.equal(surface.activeTools.includes("upsertView" as never), false);
  assert.equal(getInspectLaneToolNames().includes("getTableSchema"), true);

  const readOnlyTools = filterAuthoringToolNamesByPermissions(
    canonicalNames as never,
    new Set(["dashboard.read", "datasource.read"]),
  );
  assert.equal(readOnlyTools.includes("getDatasources"), true);
  assert.equal(readOnlyTools.includes("stageChart"), false);
  assert.equal(readOnlyTools.includes("stageViewIntent"), false);
  assert.equal(readOnlyTools.includes("composePatch"), false);

  for (const registration of AUTHORING_TOOL_REGISTRY) {
    assert.ok(
      registration.requiredPermissions?.length,
      `${registration.name} should declare requiredPermissions`,
    );
  }
});

test("runtime surface resolver centralizes approval, terminal, stale-check, and inspect policy", () => {
  const baseDecision = {
    profile: "author-dashboard",
    scope: { kind: "dashboard" },
    scopeResolution: { requires_scope_clarification: false },
    allowedTools: ["stageChart", "composePatch", "getDraftStatus", "runCheck"],
    contextBlockVariant: "dashboard",
    relevantSkillIds: [],
    stopReason: null,
  };

  assert.deepEqual(
    resolveRuntimeToolSurface({
      decision: baseDecision as never,
      approval: { decision: "approve" },
    }).activeTools,
    ["applyPatch"],
  );
  assert.deepEqual(
    resolveRuntimeToolSurface({
      decision: baseDecision as never,
      forceChatOnlyForTurn: true,
    }).activeTools,
    [],
  );
  const staleCheckSurface = resolveRuntimeToolSurface({
    decision: baseDecision as never,
    draft: { hasDraft: true, canCompose: false, blockers: ["stale_check"] },
  });
  assert.deepEqual(staleCheckSurface.activeTools, ["runCheck"]);
  assert.deepEqual(staleCheckSurface.toolChoice, { type: "tool", toolName: "runCheck" });
  assert.equal(staleCheckSurface.promptSections.includes("draft-runtime-check"), true);
  const composeReadySurface = resolveRuntimeToolSurface({
    decision: baseDecision as never,
    draft: { hasDraft: true, canCompose: true, blockers: [] },
  });
  assert.deepEqual(composeReadySurface.activeTools, ["composePatch"]);
  assert.deepEqual(composeReadySurface.toolChoice, { type: "tool", toolName: "composePatch" });
  assert.equal(composeReadySurface.promptSections.includes("draft-compose"), true);
  const inspectSurface = resolveRuntimeToolSurface({
    decision: { ...baseDecision, profile: "explore", allowedTools: ["getTableSchema"] } as never,
  });
  assert.equal(inspectSurface.mode, "inspect");
  assert.deepEqual(inspectSurface.activeTools, ["getTableSchema"]);
});

test("authoring runtime surface narrows to runCheck while waiting on stale check", async () => {
  const harness = makeHarness();
  await executeTool(harness.stageChart, {
    skill_id: "echarts-kpi-text",
    title: "销售总量",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });
  const session = makeSession({
    intent: "author",
    initialWorkingDraft: snapshotWorkingDraft(harness.workingDraft),
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[]; toolChoice: unknown };
    applySurfaceToRuntime: () => Promise<void>;
  };

  await runtime.applySurfaceToRuntime();

  assert.equal(runtime.surface.mode, "author");
  assert.deepEqual(runtime.surface.activeTools, ["runCheck"]);
  assert.deepEqual(runtime.surface.toolChoice, { type: "tool", toolName: "runCheck" });
});

test("authoring runtime surface narrows to composePatch after fresh successful check", async () => {
  const harness = makeHarness();
  await executeTool(harness.stageChart, {
    skill_id: "echarts-kpi-text",
    title: "销售总量",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });
  const check = await executeTool<{ status: string; failures: unknown[] }>(harness.runCheck, {
    scope: "dashboard",
  });
  assert.equal(check.status, "ok");
  assert.equal(check.failures.length, 0);

  const session = makeSession({
    intent: "author",
    initialWorkingDraft: snapshotWorkingDraft(harness.workingDraft),
    initialLastRunCheckState: harness.lastRunCheckState(),
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[]; toolChoice: unknown };
    applySurfaceToRuntime: () => Promise<void>;
  };

  await runtime.applySurfaceToRuntime();

  assert.equal(runtime.surface.mode, "author");
  assert.deepEqual(runtime.surface.activeTools, ["composePatch"]);
  assert.deepEqual(runtime.surface.toolChoice, { type: "tool", toolName: "composePatch" });
});

test("same-turn write attempts are blocked after stale-check surface refresh", async () => {
  let surface = buildAuthorToolSurface({
    scope: { kind: "dashboard" },
    allowedTools: ["stageChart", "composePatch"],
  });
  let lastDigest: string | null = null;
  const context = {
    systemPrompt: "",
    messages: [],
    tools: [{ name: "stageChart" }, { name: "composePatch" }],
  };
  const assistantMessage = {
    role: "assistant",
    content: [
      { type: "toolCall", id: "call_stage", name: "stageChart", arguments: {} },
      { type: "toolCall", id: "call_compose", name: "composePatch", arguments: {} },
    ],
    timestamp: 1,
  };
  const hooks = buildAuthoringPiHooks({
    getCurrentSurface: () => surface,
    getActiveToolNames: () => new Set(surface.activeTools),
    refreshRuntimeSurface: async (runtimeContext) => {
      surface = buildAuthorToolSurface({
        scope: { kind: "dashboard" },
        allowedTools: ["runCheck"],
      });
      if (runtimeContext?.tools) {
        runtimeContext.tools = [{ name: "runCheck" }] as never;
      }
    },
    getLastSurfaceDigest: () => lastDigest,
    setLastSurfaceDigest: (digest) => {
      lastDigest = digest;
    },
  });

  await hooks.afterToolCall({
    assistantMessage: assistantMessage as never,
    toolCall: { type: "toolCall", id: "call_stage", name: "stageChart", arguments: {} } as never,
    args: {},
    result: { content: [{ type: "text", text: "staged" }], details: {} },
    isError: false,
    context: context as never,
  });
  const blocked = await hooks.beforeToolCall({
    assistantMessage: assistantMessage as never,
    toolCall: { type: "toolCall", id: "call_compose", name: "composePatch", arguments: {} } as never,
    args: {},
    context: context as never,
  });

  assert.deepEqual(surface.activeTools, ["runCheck"]);
  assert.equal(context.tools.some((tool) => tool.name === "composePatch"), false);
  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? "", /composePatch.*not available/i);
});

test("same-turn restaging attempts are blocked after fresh-check surface refresh", async () => {
  let surface = buildAuthorToolSurface({
    scope: { kind: "dashboard" },
    allowedTools: ["runCheck"],
  });
  let lastDigest: string | null = null;
  const context = {
    systemPrompt: "",
    messages: [],
    tools: [{ name: "runCheck" }],
  };
  const assistantMessage = {
    role: "assistant",
    content: [
      { type: "toolCall", id: "call_check", name: "runCheck", arguments: {} },
      { type: "toolCall", id: "call_stage_again", name: "stageChart", arguments: {} },
    ],
    timestamp: 1,
  };
  const hooks = buildAuthoringPiHooks({
    getCurrentSurface: () => surface,
    getActiveToolNames: () => new Set(surface.activeTools),
    refreshRuntimeSurface: async (runtimeContext) => {
      surface = buildAuthorToolSurface({
        scope: { kind: "dashboard" },
        allowedTools: ["composePatch"],
      });
      if (runtimeContext?.tools) {
        runtimeContext.tools = [{ name: "composePatch" }] as never;
      }
    },
    getLastSurfaceDigest: () => lastDigest,
    setLastSurfaceDigest: (digest) => {
      lastDigest = digest;
    },
  });

  await hooks.afterToolCall({
    assistantMessage: assistantMessage as never,
    toolCall: { type: "toolCall", id: "call_check", name: "runCheck", arguments: {} } as never,
    args: {},
    result: { content: [{ type: "text", text: "ok" }], details: {} },
    isError: false,
    context: context as never,
  });
  const blocked = await hooks.beforeToolCall({
    assistantMessage: assistantMessage as never,
    toolCall: { type: "toolCall", id: "call_stage_again", name: "stageChart", arguments: {} } as never,
    args: {},
    context: context as never,
  });

  assert.deepEqual(surface.activeTools, ["composePatch"]);
  assert.equal(context.tools.some((tool) => tool.name === "stageChart"), false);
  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? "", /stageChart.*not available/i);
});

test("AuthoringToolGateError produces stable structured tool details", async () => {
  const surface = buildAuthorToolSurface({
    scope: { kind: "dashboard" },
    allowedTools: ["composePatch"],
  });
  let lastDigest: string | null = surfaceConfigDigest(surface);
  const gateError = new AuthoringToolGateError({
    code: "stale_check",
    userSafeSummary:
      "composePatch requires a fresh successful runCheck for the current staged document hash.",
    recoveryHint:
      "The staged draft does not have a fresh successful runtime check for its current document hash.",
    retryable: true,
  });
  const hooks = buildAuthoringPiHooks({
    getCurrentSurface: () => surface,
    getActiveToolNames: () => new Set(surface.activeTools),
    refreshRuntimeSurface: async () => {},
    getLastSurfaceDigest: () => lastDigest,
    setLastSurfaceDigest: (digest) => {
      lastDigest = digest;
    },
  });

  const override = await hooks.afterToolCall({
    assistantMessage: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_compose", name: "composePatch", arguments: {} }],
      timestamp: 1,
    } as never,
    toolCall: { type: "toolCall", id: "call_compose", name: "composePatch", arguments: {} } as never,
    args: {},
    result: {
      content: [{ type: "text", text: gateError.message }],
      details: {
        error: {
          code: gateError.code,
          userSafeSummary: gateError.userSafeSummary,
          recoveryHint: gateError.recoveryHint,
          retryable: gateError.retryable,
        },
      },
    },
    isError: true,
    context: { systemPrompt: "", messages: [], tools: [] } as never,
  });

  assert.deepEqual(override?.details, {
    error: {
      code: "stale_check",
      userSafeSummary:
        "composePatch requires a fresh successful runCheck for the current staged document hash.",
      recoveryHint:
        "The staged draft does not have a fresh successful runtime check for its current document hash.",
      retryable: true,
    },
  });
});

test("successful composePatch asks the agent loop to terminate", async () => {
  const surface = buildAuthorToolSurface({
    scope: { kind: "dashboard" },
    allowedTools: ["composePatch"],
  });
  let lastDigest: string | null = surfaceConfigDigest(surface);
  const hooks = buildAuthoringPiHooks({
    getCurrentSurface: () => surface,
    getActiveToolNames: () => new Set(surface.activeTools),
    refreshRuntimeSurface: async () => {},
    getLastSurfaceDigest: () => lastDigest,
    setLastSurfaceDigest: (digest) => {
      lastDigest = digest;
    },
  });

  const override = await hooks.afterToolCall({
    assistantMessage: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_compose", name: "composePatch", arguments: {} }],
      timestamp: 1,
    } as never,
    toolCall: { type: "toolCall", id: "call_compose", name: "composePatch", arguments: {} } as never,
    args: {},
    result: { content: [{ type: "text", text: "composePatch completed." }], details: {} },
    isError: false,
    context: { systemPrompt: "", messages: [], tools: [] } as never,
  });

  assert.deepEqual(override, { terminate: true });
});

test("ordinary tool errors are normalized without pretending to be gate errors", async () => {
  const harness = makeHarness();
  const surface = buildAuthorToolSurface({
    scope: { kind: "dashboard" },
    allowedTools: ["stageChart"],
  });
  let lastDigest: string | null = surfaceConfigDigest(surface);
  const hooks = buildAuthoringPiHooks({
    getCurrentSurface: () => surface,
    getActiveToolNames: () => new Set(surface.activeTools),
    getToolDefinition: () => harness.stageChart as never,
    refreshRuntimeSurface: async () => {},
    getLastSurfaceDigest: () => lastDigest,
    setLastSurfaceDigest: (digest) => {
      lastDigest = digest;
    },
  });

  const override = await hooks.afterToolCall({
    assistantMessage: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_stage", name: "stageChart", arguments: {} }],
      timestamp: 1,
    } as never,
    toolCall: { type: "toolCall", id: "call_stage", name: "stageChart", arguments: {} } as never,
    args: {},
    result: { content: [{ type: "text", text: "Unsupported chart skill" }], details: {} },
    isError: true,
    context: { systemPrompt: "", messages: [], tools: [] } as never,
  });

  assert.equal((override?.content?.[0] as { text?: string } | undefined)?.text?.startsWith("stageChart failed:"), true);
  assert.deepEqual((override?.details as { error: { kind: string; tool_name: string } }).error.kind, "runtime_error");
  assert.deepEqual((override?.details as { error: { kind: string; tool_name: string } }).error.tool_name, "stageChart");
});

test("selectAuthoringToolSet cannot select removed low-level tools", () => {
  const selected = selectAuthoringToolSet({
    tools: makeHarness().stageChart ? {
      stageChart: makeHarness().stageChart,
    } as never : {},
    activeTools: ["stageChart"],
  });
  assert.deepEqual(Object.keys(selected), ["stageChart"]);
});

test("approval surface is exposed only after request preflight validates the proposal", async () => {
  const baseFingerprint = canonicalDashboardDocumentFingerprint(baseDocument());
  const matched = makeSession({
    agentMessages: pendingPatchTranscript({
      proposalId: "patch-1",
      baseVersion: 7,
      draftFingerprint: "draft_fp_1",
      baseDocumentFingerprint: baseFingerprint,
    }),
    currentDocumentHash: baseFingerprint,
    approvalEvent: {
      proposalId: "patch-1",
      decision: "approve",
      baseVersion: 7,
      currentDocumentHash: baseFingerprint,
    },
  });
  const matchedSurface = (matched as never as { surface: { mode: string; activeTools: string[] } }).surface;

  assert.equal(matchedSurface.mode, "approval");
  assert.deepEqual(matchedSurface.activeTools, ["applyPatch"]);

  const mismatchedVersion = validateAuthoringApprovalPreflight({
    approvalEvent: {
      proposalId: "patch-1",
      decision: "approve",
      baseVersion: 99,
      currentDocumentHash: baseFingerprint,
    },
    currentSession: {
      version: 6,
      sessionId: "sess",
      dashboardId: "dash",
      messages: pendingPatchTranscript({
        proposalId: "patch-1",
        baseVersion: 7,
        draftFingerprint: "draft_fp_1",
        baseDocumentFingerprint: baseFingerprint,
      }) as never,
      prompt: {
        lastContextFingerprint: null,
        workingDraft: null,
        lastRunCheckState: null,
      },
      updatedAt: new Date(0).toISOString(),
    },
    dashboard: baseDocument(),
  });

  assert.ok(mismatchedVersion);
  assert.equal(mismatchedVersion.status, 409);
  const mismatchBody = await mismatchedVersion.json();
  assert.equal(mismatchBody.reason, "APPROVAL_BASE_VERSION_MISMATCH");

  const expired = validateAuthoringApprovalPreflight({
    approvalEvent: {
      proposalId: "patch-1",
      decision: "approve",
      baseVersion: 7,
      currentDocumentHash: baseFingerprint,
    },
    currentSession: {
      version: 6,
      sessionId: "sess",
      dashboardId: "dash",
      messages: pendingPatchTranscript({
        proposalId: "patch-1",
        baseVersion: 7,
        draftFingerprint: "draft_fp_1",
        baseDocumentFingerprint: baseFingerprint,
        expiresAt: Date.now() - 1,
      }) as never,
      prompt: {
        lastContextFingerprint: null,
        workingDraft: null,
        lastRunCheckState: null,
      },
      updatedAt: new Date(0).toISOString(),
    },
    dashboard: baseDocument(),
  });

  assert.ok(expired);
  assert.equal(expired.status, 409);
  const expiredBody = await expired.json();
  assert.equal(expiredBody.reason, "APPROVAL_PROPOSAL_EXPIRED");
  assert.equal(
    expiredBody.message_i18n_key,
    "error.authoring.proposal_expired",
  );

  assert.throws(
    () =>
      makeSession({
        agentMessages: pendingPatchTranscript({
          proposalId: "patch-1",
          baseVersion: 7,
          draftFingerprint: "draft_fp_1",
        }),
        currentDocumentHash: baseFingerprint,
        approvalEvent: {
          proposalId: "patch-1",
          decision: "approve",
          baseVersion: 7,
          currentDocumentHash: baseFingerprint,
        },
      }),
    /Invalid approval event reached authoring agent runtime after preflight/,
  );
});

test("stale pending proposal does not keep later authoring turns approval-blocked", () => {
  const session = makeSession({
    intent: "author",
    agentMessages: pendingPatchTranscript({
      proposalId: "patch-1",
      baseVersion: 7,
      draftFingerprint: "draft_fp_1",
      baseDocumentFingerprint: "doc_old_layout",
    }),
    currentDocumentHash: canonicalDashboardDocumentFingerprint(baseDocument()),
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[] };
  };

  assert.equal(runtime.surface.mode, "author");
  assert.equal(runtime.surface.activeTools.includes("stageChart"), true);
});

test("rejected proposal marker unlocks authoring after cold session recovery", () => {
  const baseFingerprint = canonicalDashboardDocumentFingerprint(baseDocument());
  const session = makeSession({
    intent: "author",
    agentMessages: pendingPatchTranscript({
      proposalId: "patch-1",
      baseVersion: 7,
      draftFingerprint: "draft_fp_1",
      baseDocumentFingerprint: baseFingerprint,
    }),
    rejectedProposalIds: ["patch-1"],
    currentDocumentHash: baseFingerprint,
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[] };
  };

  assert.equal(runtime.surface.mode, "author");
  assert.equal(runtime.surface.activeTools.includes("stageChart"), true);
});

test("applyPatch only consumes the matching latest composePatch proposal", () => {
  const baseFingerprint = canonicalDashboardDocumentFingerprint(baseDocument());
  const messages = [
    ...pendingPatchTranscript({
      proposalId: "patch-old",
      baseVersion: 7,
      draftFingerprint: "draft_old",
      baseDocumentFingerprint: baseFingerprint,
    }),
    ...pendingPatchTranscript({
      proposalId: "patch-latest",
      baseVersion: 7,
      draftFingerprint: "draft_latest",
      baseDocumentFingerprint: baseFingerprint,
    }),
    ...applyPatchTranscript({ suggestionId: "patch-old", timestamp: 5 }),
  ];

  const signals = deriveConversationSignalsFromTranscript({
    messages: messages as never,
    currentDocumentHash: baseFingerprint,
  });

  assert.equal(signals.approvalState, "requested");
  assert.equal(signals.latestDraftOutput?.suggestion.id, "patch-latest");
});

test("reject turn discards warm working draft before next authoring request", async () => {
  const baseFingerprint = canonicalDashboardDocumentFingerprint(baseDocument());
  const session = makeSession({
    dashboard: baseDocument(),
    intent: "author",
    agentMessages: pendingPatchTranscript({
      proposalId: "patch-1",
      baseVersion: 7,
      draftFingerprint: "draft_fp_1",
      baseDocumentFingerprint: baseFingerprint,
    }),
    initialWorkingDraft: stagedGmvDraftSnapshot(),
    currentDocumentHash: baseFingerprint,
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[] };
    applySurfaceToRuntime: () => Promise<void>;
  };

  session.setTurnConfig({
    dashboard: baseDocument(),
    intent: "cancel",
    promptText: "Reject the staged patch.",
    approvalEvent: {
      proposalId: "patch-1",
      decision: "reject",
      baseVersion: 7,
      currentDocumentHash: baseFingerprint,
    },
    currentDocumentHash: baseFingerprint,
  });

  session.setTurnConfig({
    dashboard: baseDocument(),
    intent: "author",
    promptText: "重新帮我制作 GMV 周趋势图",
    approvalEvent: null,
    currentDocumentHash: baseFingerprint,
  });
  await runtime.applySurfaceToRuntime();

  assert.equal(runtime.surface.mode, "author");
  assert.equal(runtime.surface.activeTools.includes("stageChart"), true);
  assert.equal(runtime.surface.activeTools.includes("runCheck"), true);
  assert.equal(runtime.surface.activeTools.includes("composePatch"), true);
});

test("warm session ignores invalid focusedViewId when resolved scope is dashboard", async () => {
  const session = makeSession({
    dashboard: seededDocument(),
    focusedViewId: "v_total_gmv",
    intent: "author",
  });
  session.setTurnConfig({
    dashboard: seededDocument(),
    focusedViewId: "missing-view",
    intent: "author",
    promptText: "Create another card",
  });
  const runtime = session as never as {
    applySurfaceToRuntime: (context: {
      systemPrompt: string;
      messages: unknown[];
      tools: PiToolForTest[];
    }) => Promise<void>;
  };
  const context: {
    systemPrompt: string;
    messages: unknown[];
    tools: PiToolForTest[];
  } = { systemPrompt: "", messages: [], tools: [] };

  await runtime.applySurfaceToRuntime(context);

  const getView = context.tools.find((tool) => tool.name === "getView");
  assert.ok(getView, "getView should be active in dashboard authoring mode");
  const params = getView.prepareArguments
    ? getView.prepareArguments({ view_id: "v_total_gmv" })
    : { view_id: "v_total_gmv" };
  const result = await getView.execute("tool-call-1", params);
  assert.equal((result.details as { match_status?: string }).match_status, "exact");
});

test("focused runtime still blocks access outside a valid focused view", async () => {
  const document = seededDocument();
  const [firstView] = document.dashboard_spec.views;
  document.dashboard_spec.views.push({
    ...JSON.parse(JSON.stringify(firstView)),
    id: "v_other",
    title: "Other View",
  });
  const session = makeSession({
    dashboard: document,
    focusedViewId: "v_total_gmv",
    intent: "author",
    promptText: "Revise the selected metric",
  });
  const runtime = session as never as {
    applySurfaceToRuntime: (context: {
      systemPrompt: string;
      messages: unknown[];
      tools: PiToolForTest[];
    }) => Promise<void>;
  };
  const context: {
    systemPrompt: string;
    messages: unknown[];
    tools: PiToolForTest[];
  } = { systemPrompt: "", messages: [], tools: [] };

  await runtime.applySurfaceToRuntime(context);

  const getView = context.tools.find((tool) => tool.name === "getView");
  assert.ok(getView, "getView should be active in focused authoring mode");
  const params = getView.prepareArguments
    ? getView.prepareArguments({ view_id: "v_other" })
    : { view_id: "v_other" };
  await assert.rejects(
    () => getView.execute("tool-call-2", params),
    /restricted to "v_total_gmv"/,
  );
});

test("runtime surface refresh applies turn-local tool failure filtering", async () => {
  const session = makeSession({ intent: "author" });
  session.setTurnStateForTest({
    stepHistoryInTurn: [
      { toolName: "stageChart", outcome: "error" },
      { toolName: "stageChart", outcome: "error" },
      { toolName: "stageChart", outcome: "error" },
    ],
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[] };
    applySurfaceToRuntime: (context?: {
      systemPrompt: string;
      messages: unknown[];
      tools?: Array<{ name: string }>;
    }) => Promise<void>;
  };
  const context: {
    systemPrompt: string;
    messages: unknown[];
    tools: Array<{ name: string }>;
  } = { systemPrompt: "", messages: [], tools: [] };

  await runtime.applySurfaceToRuntime(context);

  assert.equal(runtime.surface.mode, "author");
  assert.equal(runtime.surface.activeTools.includes("stageChart"), false);
  assert.equal(context.tools.some((tool) => tool.name === "stageChart"), false);
});

test("inspect runtime surface respects filtered read tools", async () => {
  const session = makeSession({
    intent: "explore",
    promptText: "What schema is available?",
  });
  session.setTurnStateForTest({
    stepHistoryInTurn: [
      { toolName: "getTableSchema", outcome: "error" },
      { toolName: "getTableSchema", outcome: "error" },
      { toolName: "getTableSchema", outcome: "error" },
    ],
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[] };
    applySurfaceToRuntime: () => Promise<void>;
  };

  await runtime.applySurfaceToRuntime();

  assert.equal(runtime.surface.mode, "inspect");
  assert.equal(runtime.surface.activeTools.includes("getTableSchema"), false);
  assert.equal(runtime.surface.activeTools.includes("getDatasources"), true);
});

test("terminal authoring turns keep the refreshed surface chat-only", async () => {
  const baseFingerprint = canonicalDashboardDocumentFingerprint(baseDocument());
  const session = makeSession({
    agentMessages: pendingPatchTranscript({
      proposalId: "patch-1",
      baseVersion: 7,
      draftFingerprint: "draft_fp_1",
      baseDocumentFingerprint: baseFingerprint,
    }),
    currentDocumentHash: baseFingerprint,
    approvalEvent: {
      proposalId: "patch-1",
      decision: "approve",
      baseVersion: 7,
      currentDocumentHash: baseFingerprint,
    },
  });
  session.setTurnStateForTest({ forceChatOnlyForTurn: true });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[] };
    applySurfaceToRuntime: () => Promise<void>;
  };

  await runtime.applySurfaceToRuntime();

  assert.equal(runtime.surface.mode, "chat");
  assert.deepEqual(runtime.surface.activeTools, []);
});

test("context fingerprint snapshot is read dynamically after context generation", () => {
  const session = makeSession();
  const runtime = session as never as {
    lastContextFingerprint: string;
    buildContextBlockSnapshot: () => { fingerprint: string };
  };
  const result = {
    get contextFingerprint() {
      return runtime.lastContextFingerprint || null;
    },
  };

  assert.equal(result.contextFingerprint, null);
  const block = runtime.buildContextBlockSnapshot();

  assert.match(block.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.contextFingerprint, block.fingerprint);
});

test("stageDelete removes a view transactionally with dependent bindings", async () => {
  const harness = makeHarness(seededDocument());
  const result = await executeTool<{
    artifact_ids: { removed_view_ids: string[]; removed_binding_ids: string[] };
  }>(harness.stageDelete, {
    target: { kind: "view", view_id: "v_total_gmv" },
  });
  const candidate = harness.candidate();

  assert.deepEqual(result.artifact_ids.removed_view_ids, ["v_total_gmv"]);
  assert.deepEqual(result.artifact_ids.removed_binding_ids, ["b_v_total_gmv_value"]);
  assert.equal(candidate.dashboard_spec.views.length, 0);
  assert.equal(candidate.bindings.length, 0);
});

test("apply session conflict resolution treats already-applied dashboard states as idempotent", () => {
  const appliedDashboard = seededDocument();
  const makePayload = (
    canonicalDraft: DashboardDocument,
    lastSuggestionId: string | null,
  ) => ({
    workspaceId: "ws_default",
    userId: "usr_alice",
    dashboardId: "db_test",
    editingSessionId: "sess_test",
    focusViewId: null,
    baseVersion: 1,
    dirty: true,
    stale: false,
    mobileLayoutMode: "custom",
    canonicalDraft,
    authoringState: { currentSuggestionId: null, pendingApproval: null },
    viewStatesByViewId: {},
    approvalState: { pending: false, lastSuggestionId },
    updatedAt: "2026-05-13T00:00:00.000Z",
  });

  assert.equal(
    resolveAppliedEditingSessionConflict({
      latestPayload: makePayload(baseDocument(), "suggestion-1") as never,
      suggestionId: "suggestion-1",
      appliedDashboard,
    }),
    "already_applied",
  );
  assert.equal(
    resolveAppliedEditingSessionConflict({
      latestPayload: makePayload(appliedDashboard, null) as never,
      suggestionId: "suggestion-1",
      appliedDashboard,
    }),
    "same_dashboard",
  );
  assert.equal(
    resolveAppliedEditingSessionConflict({
      latestPayload: makePayload(baseDocument(), null) as never,
      suggestionId: "suggestion-1",
      appliedDashboard,
    }),
    "conflict",
  );
});

test("stageReplaceChart rebuilds a focused view as one draft transaction", async () => {
  const harness = makeHarness(seededDocument(), { focusedViewId: "v_total_gmv" });
  const result = await executeTool<{
    artifact_ids: {
      replaced_view_id: string;
      removed_view_ids: string[];
      removed_query_ids: string[];
      removed_binding_ids: string[];
      view_id: string;
      query_id?: string;
      binding_ids: string[];
    };
    draft_status: { blockers: string[] };
  }>(harness.stageReplaceChart, {
    replace_view_id: "v_total_gmv",
    skill_id: "echarts-kpi-text",
    title: "重建 GMV",
    datasource_id: "testing-db",
    table: "sales_weekly_fact",
    fields: { value: { source_field: "gmv", aggregation: "sum" } },
  });
  const candidate = harness.candidate();
  const desktopItem = candidate.dashboard_spec.layout.desktop?.items.find(
    (item) => item.view_id === "v_total_gmv",
  );

  assert.equal(result.artifact_ids.replaced_view_id, "v_total_gmv");
  assert.deepEqual(result.artifact_ids.removed_view_ids, ["v_total_gmv"]);
  assert.deepEqual(result.artifact_ids.removed_query_ids, ["q_total_gmv"]);
  assert.deepEqual(result.artifact_ids.removed_binding_ids, ["b_v_total_gmv_value"]);
  assert.equal(result.artifact_ids.view_id, "v_total_gmv");
  assert.equal(candidate.dashboard_spec.views.length, 1);
  assert.equal(candidate.dashboard_spec.views[0]?.id, "v_total_gmv");
  assert.equal(candidate.dashboard_spec.views[0]?.title, "重建 GMV");
  assert.equal(candidate.query_defs.some((query) => query.id === "q_total_gmv"), false);
  assert.equal(candidate.query_defs.some((query) => query.id === result.artifact_ids.query_id), true);
  assert.equal(candidate.bindings.some((binding) => binding.id === "b_v_total_gmv_value"), true);
  assert.deepEqual(
    desktopItem && { x: desktopItem.x, y: desktopItem.y, w: desktopItem.w, h: desktopItem.h },
    { x: 0, y: 0, w: 4, h: 3 },
  );
  assert.equal(result.draft_status.blockers.includes("stale_check"), true);
  assert.equal(result.draft_status.blockers.includes("staging_not_started"), false);
});

test("stageReplaceChart rejects non-focused or unknown replacement without dirtying draft", async () => {
  const doc = seededDocument();
  doc.dashboard_spec.views.push({
    id: "v_other",
    title: "Other",
    view_intent: doc.dashboard_spec.views[0]!.view_intent,
    renderer: doc.dashboard_spec.views[0]!.renderer,
  });
  doc.dashboard_spec.layout.desktop?.items.push({
    view_id: "v_other",
    x: 4,
    y: 0,
    w: 4,
    h: 3,
  });
  const harness = makeHarness(doc, { focusedViewId: "v_total_gmv" });
  const beforeFingerprint = buildDocumentFingerprint(harness.candidate());

  await assert.rejects(
    executeTool(harness.stageReplaceChart, {
      replace_view_id: "v_other",
      skill_id: "echarts-kpi-text",
      title: "Should fail",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: { value: { source_field: "gmv", aggregation: "sum" } },
    }),
    /Focused replacement can only replace/,
  );
  assert.equal(buildDocumentFingerprint(harness.candidate()), beforeFingerprint);
  assert.equal(harness.workingDraft.dirtyViewIds.size, 0);

  const dashboardHarness = makeHarness(seededDocument());
  const dashboardBeforeFingerprint = buildDocumentFingerprint(dashboardHarness.candidate());
  await assert.rejects(
    executeTool(dashboardHarness.stageReplaceChart, {
      replace_view_id: "v_missing",
      skill_id: "echarts-kpi-text",
      title: "Should fail",
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
      fields: { value: { source_field: "gmv", aggregation: "sum" } },
    }),
    /Requested view "v_missing" was not found/,
  );
  assert.equal(
    buildDocumentFingerprint(dashboardHarness.candidate()),
    dashboardBeforeFingerprint,
  );
  assert.equal(dashboardHarness.workingDraft.dirtyViewIds.size, 0);
});

test("provider boundary drops orphan tool results and preserves paired content tool calls", () => {
  const orphan = convertToLlm([
    {
      role: "toolResult",
      toolCallId: "call_orphan",
      toolName: "getTableSchema",
      content: [{ type: "text", text: "stale schema output" }],
      details: { datasource_id: "testing-db" },
      isError: false,
      timestamp: 1,
    },
  ] as never);
  assert.deepEqual(orphan, []);

  const paired = sanitizeToolCallPairs([
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_schema",
          name: "getTableSchema",
          input: {},
        },
      ],
      timestamp: 1,
    },
    {
      role: "toolResult",
      toolCallId: "call_schema",
      toolName: "getTableSchema",
      content: [{ type: "text", text: "schema" }],
      details: { datasource_id: "testing-db" },
      isError: false,
      timestamp: 2,
    },
  ] as never);
  assert.deepEqual(paired.map((message) => message.role), ["assistant", "toolResult"]);
});

test("session transcript sanitizer preserves tool results for approval preflight", () => {
  const sanitized = sanitizeAgentMessages([
    {
      role: "toolResult",
      toolCallId: "call_patch",
      toolName: "composePatch",
      content: [{ type: "text", text: "proposal ready" }],
      details: {
        suggestion: {
          id: "patch-approval",
          patch: { operations: [] },
        },
      },
      isError: false,
      timestamp: 1,
    },
  ] as never);

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0]?.role, "toolResult");
});

test("authoring prompt keeps global rules and omits migrated tool contracts", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
  });

  assert.match(prompt, /Write and delete tools are available as capabilities/i);
  assert.match(prompt, /Staging is not the same as publishing/i);
  assert.doesNotMatch(prompt, /listDatasourceTables for table discovery/i);
  assert.doesNotMatch(prompt, /runCheck\.scope must be exactly "dashboard" or "view"/i);
  assert.doesNotMatch(prompt, /Never write SQL, QueryDef\.output, renderer\.option_template/i);
  assert.doesNotMatch(prompt, /repair\/debug tools only/i);
});

test("runtime prompt aggregates active tool contracts from tool metadata only", () => {
  const session = makeSession();
  const runtime = session as never as {
    surface: {
      mode: string;
      activeTools: string[];
      toolChoice: string;
      promptSections: string[];
    };
    buildSystemPromptForSurface: (surface: unknown) => string;
  };

  const prompt = runtime.buildSystemPromptForSurface({
    ...runtime.surface,
    activeTools: ["runCheck"],
  });

  assert.match(prompt, /Active tool contracts:/);
  assert.match(prompt, /scope must be exactly "dashboard" or "view"/);
  assert.doesNotMatch(prompt, /SQL, QueryDef\.output, renderer\.option_template/);
});
