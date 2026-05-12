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
const { stageChartInputSchema } = await import(
  "../src/ai/authoring/tools/schemas.ts"
);
const { Value } = await import("typebox/value");
const { AuthoringAgentSession } = await import(
  "../src/ai/authoring/agent/session.ts"
);
const { validateAuthoringApprovalPreflight } = await import(
  "../src/server/authoring/approval-preflight.ts"
);
const { createValidationOnlyAuthoringDependencies } = await import(
  "../src/ai/authoring/runtime/dependencies.ts"
);
const { dashboardDocumentPersistenceFingerprint } = await import(
  "../src/domain/dashboard/document-fingerprint.ts"
);
const { deriveConversationSignalsFromTranscript } = await import(
  "../src/ai/authoring/runtime/transcript-inspection.ts"
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
    dashboard_spec: {
      schema_version: "0.2",
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
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: { name: "Reliability Dashboard" },
      filters: [],
      views: [
        {
          id: "v_total_gmv",
          title: "销售总量",
          renderer: {
            kind: "echarts",
            option_template: { graphic: [{ style: { text: "0" } }] },
            slots: [
              {
                id: "value",
                path: "graphic[0].style.text",
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

function makeHarness(document: DashboardDocument = baseDocument()) {
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
    focusedViewId: null,
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
  }>(harness.composePatch, { reason: "Compose approval proposal after fresh check." });
  assert.match(patch.suggestion.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(patch.base_version, 2);
  assert.equal(patch.suggestion.dashboard.dashboard_spec.views.length, 1);
});

test("stageChart supports line, bar, kpi, and gauge builders through runtime SQL generation", async () => {
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
  ];

  for (const chart of cases) {
    const harness = makeHarness();
    await executeTool(harness.stageChart, {
      ...chart,
      datasource_id: "testing-db",
      table: "sales_weekly_fact",
    });
    assert.match(harness.candidate().query_defs[0]?.sql_template ?? "", chart.sql);
    assert.equal(harness.candidate().bindings.length > 0, true);
  }
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
    "stageDelete",
  ]) {
    assert.equal(canonicalNames.includes(newName as never), true);
  }

  const surface = buildAuthorToolSurface({
    scope: { kind: "dashboard" },
    allowedTools: canonicalNames as never,
  });
  assert.equal(surface.activeTools.includes("stageChart"), true);
  assert.equal(surface.activeTools.includes("stageDelete"), true);
  assert.equal(surface.activeTools.includes("upsertView" as never), false);
  assert.equal(getInspectLaneToolNames().includes("getTableSchema"), true);
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
  assert.equal(
    resolveRuntimeToolSurface({
      decision: { ...baseDecision, profile: "explore", allowedTools: ["getTableSchema"] } as never,
    }).mode,
    "inspect",
  );
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
    result: { content: [{ type: "text", text: gateError.message }], details: {} },
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
  const baseFingerprint = dashboardDocumentPersistenceFingerprint(baseDocument());
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
    currentDocumentHash: dashboardDocumentPersistenceFingerprint(baseDocument()),
  });
  const runtime = session as never as {
    surface: { mode: string; activeTools: string[] };
  };

  assert.equal(runtime.surface.mode, "author");
  assert.equal(runtime.surface.activeTools.includes("stageChart"), true);
});

test("rejected proposal marker unlocks authoring after cold session recovery", () => {
  const baseFingerprint = dashboardDocumentPersistenceFingerprint(baseDocument());
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
  const baseFingerprint = dashboardDocumentPersistenceFingerprint(baseDocument());
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
  const baseFingerprint = dashboardDocumentPersistenceFingerprint(baseDocument());
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
  const runtime = session as never as {
    stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }>;
    surface: { mode: string; activeTools: string[] };
    applySurfaceToRuntime: (context?: {
      systemPrompt: string;
      messages: unknown[];
      tools?: Array<{ name: string }>;
    }) => Promise<void>;
  };
  runtime.stepHistoryInTurn = [
    { toolName: "stageChart", outcome: "error" },
    { toolName: "stageChart", outcome: "error" },
    { toolName: "stageChart", outcome: "error" },
  ];
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
  const runtime = session as never as {
    stepHistoryInTurn: Array<{ toolName: string; outcome: "ok" | "error" }>;
    surface: { mode: string; activeTools: string[] };
    applySurfaceToRuntime: () => Promise<void>;
  };
  runtime.stepHistoryInTurn = [
    { toolName: "getTableSchema", outcome: "error" },
    { toolName: "getTableSchema", outcome: "error" },
    { toolName: "getTableSchema", outcome: "error" },
  ];

  await runtime.applySurfaceToRuntime();

  assert.equal(runtime.surface.mode, "inspect");
  assert.equal(runtime.surface.activeTools.includes("getTableSchema"), false);
  assert.equal(runtime.surface.activeTools.includes("getDatasources"), true);
});

test("terminal authoring turns keep the refreshed surface chat-only", async () => {
  const baseFingerprint = dashboardDocumentPersistenceFingerprint(baseDocument());
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
  const runtime = session as never as {
    forceChatOnlyForTurn: boolean;
    surface: { mode: string; activeTools: string[] };
    applySurfaceToRuntime: () => Promise<void>;
  };

  runtime.forceChatOnlyForTurn = true;
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
