import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import type { AuthoringScopeInput } from "../src/ai/authoring/scope.ts";
import type {
  AuthoringChatSessionPayload,
  AuthoringTaskStateSnapshot,
} from "../src/ai/authoring/contracts/session-state.ts";
import type { MutationDescriptor } from "../src/ai/authoring/messages/invalidate-on-mutation.ts";
import type { AuthoringSkillReferenceCheck } from "../src/ai/authoring/skill-checks.ts";
import type {
  DashboardDocument,
  DashboardView,
  QueryDef,
} from "../src/contracts/dashboard.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { computeAuthoringScope } = await import("../src/ai/authoring/scope.ts");
const { buildAuthoringSystemPrompt } = await import("../src/ai/authoring/prompt.ts");
const { buildRepairToolPrompt } = await import("../src/ai/authoring/repair.ts");
const { sanitizeAuthoringChatSessionPayload } = await import(
  "../src/ai/authoring/contracts/session-state.ts"
);
const {
  updateTaskStateFromUserTurn,
  updateTaskStateFromToolStep,
} = await import("../src/ai/authoring/task-state.ts");
const { loadAuthoringSkillReference } = await import(
  "../src/server/ai/skill-loader.ts"
);
const {
  buildApplyPatchTool,
  buildComposePatchTool,
  buildUpsertBindingTool,
  buildUpsertQueryTool,
  buildUpsertViewTool,
} = await import("../src/ai/authoring/tools/write-tools.ts");
const {
  buildLoadSkillReferenceTool,
  buildLoadSkillTool,
} = await import("../src/ai/authoring/tools/shared-tools.ts");
const { buildAuthoringTools } = await import("../src/ai/authoring/tools/index.ts");
const { createWorkingDraftState } = await import(
  "../src/ai/authoring/tools/draft-state.ts"
);
const { createValidationOnlyAuthoringDependencies } = await import(
  "../src/ai/authoring/engine/dependencies.ts"
);
const {
  buildCandidateDocument,
  buildDocumentFingerprint,
} = await import("../src/ai/authoring/tools/candidate-document.ts");
const {
  validateBindingAgainstSkillCheck,
  validateQueryAgainstSkillCheck,
  validateViewAgainstSkillCheck,
} = await import("../src/ai/authoring/skill-checks.ts");
const { AuthoringToolGateError } = await import(
  "../src/ai/authoring/tool-gate-error.ts"
);
const {
  draftNeedsBindingBeforeCompose,
  isDraftReadyForCompose,
} = await import("../src/ai/authoring/compose-readiness.ts");
const { resolveMechanicalDraftCompletionTool } = await import(
  "../src/ai/authoring/draft-completion.ts"
);
const {
  UPSERT_BINDING_TOOL_CONTRACT,
  UPSERT_QUERY_TOOL_CONTRACT,
  UPSERT_VIEW_TOOL_CONTRACT,
} = await import("../src/ai/authoring/tool-contracts.ts");
const { finalizeIncompleteToolCalls } = await import(
  "../src/ai/authoring/messages/incomplete-tools.ts"
);
const { stripAuthoringMessagesForModel } = await import(
  "../src/ai/authoring/messages/client-parts.ts"
);
const { getAuthoringWorkingIndicator } = await import(
  "../src/web/authoring/agent/working-indicator.ts"
);

const dashboardBase = {
  id: "db_test",
  name: "Reliability Dashboard",
  views: [],
  datasources: [{ datasource_id: "testing-db", label: "testing-db" }],
  checksSummary: { ok: 0, warning: 0, error: 0 },
};

const skills = [
  {
    id: "data-format-skills",
    name: "Data format skills",
    description: "Reusable data shapes for KPI, time series, categories, and rows.",
    path: "skills/data-format-skills/SKILL.md",
    triggers: ["指标卡", "趋势", "对比", "明细"],
  },
];

function baseDocument(): DashboardDocument {
  return {
    dashboard_spec: {
      schema_version: "0.2",
      dashboard: { name: "Skill Gate Dashboard" },
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

function lineViewSpec(
  seriesType = "line",
): { view_id: string; title: string; renderer: DashboardView["renderer"] } {
  return {
    view_id: "v_gmv_trend",
    title: "GMV Trend",
    renderer: {
      kind: "echarts",
      option_template: {
        xAxis: { type: "category", data: [] },
        yAxis: { type: "value" },
        series: [{ type: seriesType, data: [] }],
      },
      slots: [
        { id: "x", path: "xAxis.data", value_kind: "array", required: true },
        { id: "y", path: "series[0].data", value_kind: "array", required: true },
      ],
    },
  };
}

function timeSeriesQuery(): QueryDef {
  return {
    id: "q_gmv_trend",
    name: "GMV Trend",
    datasource_id: "testing-db",
    sql_template:
      "SELECT week_start AS bucket_date, SUM(gmv) AS metric_value FROM public.sales_weekly_fact GROUP BY week_start ORDER BY week_start",
    params: [],
    output: {
      kind: "rows",
      schema: [
        { name: "bucket_date", type: "date", nullable: false },
        { name: "metric_value", type: "number", nullable: false },
      ],
    },
  };
}

async function loadRequiredCheck(
  skillId: string,
  referenceName: string,
): Promise<AuthoringSkillReferenceCheck> {
  const reference = await loadAuthoringSkillReference(skillId, referenceName);
  assert.ok(reference?.check, `${skillId}/${referenceName} must define skill-check`);
  return reference.check;
}

function makeToolHarness(
  checks: AuthoringSkillReferenceCheck[] = [],
  document: DashboardDocument = baseDocument(),
) {
  const workingDraft = createWorkingDraftState(null);
  const mutations: MutationDescriptor[] = [];
  const common = {
    dashboard: document,
    focusedViewId: null,
    workingDraft,
    ensureRepairWindowOpen: () => {},
    markWorkingDraftUpdated: () => {},
    recordMutation: (mutation) => {
      mutations.push(mutation);
    },
    getLoadedSkillReferenceChecks: () => checks,
    buildCandidateDocument,
    buildDocumentFingerprint,
  };

  return {
    workingDraft,
    mutations,
    upsertQuery: buildUpsertQueryTool(common),
    upsertView: buildUpsertViewTool({
      ...common,
      checks: null,
      clearViewPhaseDraft: () => {},
    }),
    upsertBinding: buildUpsertBindingTool(common),
    candidate: () => buildCandidateDocument(document, workingDraft),
  };
}

async function executeTool(toolInstance: unknown, input: unknown) {
  const execute = (toolInstance as { execute?: (input: unknown) => Promise<unknown> })
    .execute;
  assert.equal(typeof execute, "function");
  return execute(input);
}

function scopeInput(
  patch: Partial<AuthoringScopeInput> & {
    latestUserText?: string;
  },
): AuthoringScopeInput {
  return {
    dashboard: dashboardBase,
    conversation: {
      latestUserText: patch.latestUserText ?? "",
      latestDraftOutput: null,
      approvalState: "none",
    },
    focusedViewId: null,
    stepHistoryInTurn: [],
    skills,
    intentSignal: null,
    lockedMode: null,
    ...patch,
  };
}

type ReplayEvent =
  | { kind: "user"; text: string; intent?: AuthoringScopeInput["intentSignal"] }
  | {
      kind: "tool-step";
      toolCalls: Array<{ toolName?: string; input?: unknown }>;
      toolResults?: Array<{ toolName?: string; output?: unknown; error?: unknown }>;
      visibleText?: string;
    };

function replayAuthoringTraceFixture(events: ReplayEvent[]) {
  let taskState: AuthoringTaskStateSnapshot | null = null;
  const stepHistory: AuthoringScopeInput["stepHistoryInTurn"] = [];
  const decisions: ReturnType<typeof computeAuthoringScope>[] = [];
  const visibleTexts: string[] = [];

  for (const event of events) {
    if (event.kind === "user") {
      taskState = updateTaskStateFromUserTurn({
        previous: taskState,
        latestUserText: event.text,
      });
      decisions.push(
        computeAuthoringScope(
          scopeInput({
            latestUserText: event.text,
            intentSignal: event.intent,
            stepHistoryInTurn: [...stepHistory],
          }),
        ),
      );
      continue;
    }

    taskState = updateTaskStateFromToolStep({
      previous: taskState,
      toolCalls: event.toolCalls,
      toolResults: event.toolResults ?? [],
    });
    for (const call of event.toolCalls) {
      const matchingResults =
        event.toolResults?.filter((result) => result.toolName === call.toolName) ??
        [];
      stepHistory.push({
        toolName: call.toolName ?? "",
        outcome: matchingResults.some((result) => result.error === undefined)
          ? "ok"
          : "error",
      });
    }
    if (event.visibleText) {
      visibleTexts.push(event.visibleText);
    }
  }

  return { decisions, taskState, stepHistory, visibleTexts };
}

test("taskState is sanitized and remains backward compatible in chat session payloads", () => {
  const payload: AuthoringChatSessionPayload = {
    version: 2,
    sessionId: "sess_1",
    dashboardId: "db_1",
    messages: [],
    updatedAt: "2026-04-25T00:00:00.000Z",
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
      taskState: {
        phase: "awaiting_data_confirmation",
        goalSummary: "销售总览",
        loadedSkillReferences: ["data-format-skills/time-series"],
        updatedAt: "2026-04-25T00:00:00.000Z",
      },
    },
  };

  assert.equal(
    sanitizeAuthoringChatSessionPayload(payload).prompt.taskState?.phase,
    "awaiting_data_confirmation",
  );

  const legacy = {
    ...payload,
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
    },
  } as AuthoringChatSessionPayload;

  assert.equal(
    sanitizeAuthoringChatSessionPayload(legacy).prompt.taskState,
    null,
  );
});

test("unfinished tool-call streams are finalized before session persistence", () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "做 GMV 趋势" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "开始搭建。" },
        {
          type: "tool-upsertQuery",
          state: "input-streaming",
          toolCallId: "call_1",
          input: {},
        },
      ],
    },
  ] as AuthoringMessage[];

  const finalized = finalizeIncompleteToolCalls(messages);
  const part = finalized[1].parts[1] as { state?: string; errorText?: string };
  assert.equal(part.state, "output-error");
  assert.match(part.errorText ?? "", /AUTHORING_TURN_INTERRUPTED/);
});

test("unfinished historical tool calls are stripped before model transport", () => {
  const messages = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "做 GMV 趋势" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "开始搭建。" },
        {
          type: "tool-upsertQuery",
          state: "input-streaming",
          toolCallId: "call_1",
          input: {},
        },
      ],
    },
  ] as AuthoringMessage[];

  const stripped = stripAuthoringMessagesForModel(messages);
  assert.deepEqual(stripped[1].parts, [{ type: "text", text: "开始搭建。" }]);
});

test("working indicator describes long-running reasoning and tool-call phases", () => {
  const userOnly = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "做 GMV 趋势" }],
    },
  ] as AuthoringMessage[];

  assert.equal(
    getAuthoringWorkingIndicator({
      messages: userOnly,
      agentStatus: "streaming",
      inactiveMs: 0,
    }),
    "understanding",
  );

  assert.equal(
    getAuthoringWorkingIndicator({
      messages: [
        ...userOnly,
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "reasoning", text: "Need trend chart." }],
        },
      ] as AuthoringMessage[],
      agentStatus: "streaming",
      inactiveMs: 0,
    }),
    "thinking",
  );

  assert.equal(
    getAuthoringWorkingIndicator({
      messages: [
        ...userOnly,
        {
          id: "a2",
          role: "assistant",
          parts: [
            {
              type: "tool-upsertQuery",
              state: "input-streaming",
              toolCallId: "call_1",
              input: {},
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "streaming",
      inactiveMs: 0,
    }),
    "preparingTool",
  );

  assert.equal(
    getAuthoringWorkingIndicator({
      messages: [
        ...userOnly,
        {
          id: "a3",
          role: "assistant",
          parts: [
            {
              type: "tool-upsertQuery",
              state: "input-available",
              toolCallId: "call_1",
              input: {},
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "streaming",
      inactiveMs: 0,
    }),
    "executingTool",
  );

  assert.equal(
    getAuthoringWorkingIndicator({
      messages: userOnly,
      agentStatus: "streaming",
      inactiveMs: 10_000,
    }),
    "slow",
  );

  assert.equal(
    getAuthoringWorkingIndicator({
      messages: userOnly,
      agentStatus: "ready",
      inactiveMs: 10_000,
    }),
    null,
  );
});

test("scope does not preemptively remove write tools when data context is missing", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "我想做一个销售总览",
    }),
  );

  assert.equal(decision.mode, "author-dashboard");
  assert.equal(decision.activeTools.includes("upsertView"), true);
  assert.equal(decision.activeTools.includes("upsertQuery"), true);
});

test("existing views do not trigger a separate business-intent gate", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      dashboard: {
        ...dashboardBase,
        views: [
          {
            id: "existing",
            title: "Existing",
            renderer_kind: "echarts",
            check_status: "ok",
          },
        ],
      },
      latestUserText: "我想新增一个订单趋势图",
    }),
  );

  assert.equal(decision.mode, "author-dashboard");
  assert.equal(decision.activeTools.includes("upsertView"), true);
});

test("approval guard wins over default authoring tools", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "继续",
      conversation: {
        latestUserText: "继续",
        approvalState: "approved",
        latestDraftOutput: null,
      },
    }),
  );

  assert.equal(decision.mode, "approval");
  assert.deepEqual(decision.activeTools, ["applyPatch"]);
});

test("confirmed data followup keeps authoring tools available without view-structure blocker", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "可以的",
    }),
  );

  assert.equal(decision.mode, "author-dashboard");
  assert.equal(decision.activeTools.includes("upsertView"), true);
  assert.equal(decision.activeTools.includes("composePatch"), true);
});

test("ready data context plus affirmative followup keeps write tools available", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "可以",
    }),
  );

  assert.equal(decision.mode, "author-dashboard");
  assert.equal(decision.activeTools.includes("upsertView"), true);
  assert.equal(decision.activeTools.includes("upsertQuery"), true);
});

test("explicit build report request gets the same authoring tool surface", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "先搭建 GMV 报表",
    }),
  );

  assert.equal(decision.mode, "author-dashboard");
  assert.equal(decision.activeTools.includes("upsertView"), true);
  assert.equal(decision.activeTools.includes("upsertQuery"), true);
});

test("repeated write-tool errors remove only the failing tool from the next step", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "继续创建 GMV 趋势",
      stepHistoryInTurn: [
        { toolName: "upsertView", outcome: "error" },
        { toolName: "upsertView", outcome: "error" },
        { toolName: "upsertView", outcome: "error" },
      ],
    }),
  );

  assert.equal(decision.mode, "author-dashboard");
  assert.equal(decision.activeTools.includes("upsertView"), false);
  assert.equal(decision.activeTools.includes("upsertQuery"), true);
  assert.equal(decision.activeTools.includes("upsertBinding"), true);
});

test("skill trigger matching and data-format skill-reference calls are tracked", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "做一个趋势图",
    }),
  );
  assert.deepEqual(decision.relevantSkillIds, ["data-format-skills"]);

  const taskState = updateTaskStateFromToolStep({
    previous: null,
    toolCalls: [
      {
        toolName: "loadSkillReference",
        input: JSON.stringify({
          skill_id: "data-format-skills",
          reference_name: "time-series",
        }),
      },
      {
        toolName: "loadSkillReference",
        input: JSON.stringify({
          skill_id: "data-format-skills",
          reference_name: "scalar-kpi",
        }),
      },
      {
        toolName: "loadSkillReference",
        input: JSON.stringify({
          skill_id: "data-format-skills",
          reference_name: "category-series",
        }),
      },
    ],
    toolResults: [{ toolName: "loadSkillReference", output: { ok: true } }],
  });
  assert.ok(
    taskState.loadedSkillReferences.includes("data-format-skills/time-series"),
  );
  assert.ok(
    taskState.loadedSkillReferences.includes("data-format-skills/scalar-kpi"),
  );
  assert.ok(
    taskState.loadedSkillReferences.includes("data-format-skills/category-series"),
  );
});

test("loaded skill references persist machine-readable checks in task state", async () => {
  const timeSeries = await loadAuthoringSkillReference(
    "data-format-skills",
    "time-series",
  );
  assert.ok(timeSeries?.check);

  const taskState = updateTaskStateFromToolStep({
    previous: null,
    toolCalls: [
      {
        toolName: "loadSkillReference",
        input: JSON.stringify({
          skill_id: "data-format-skills",
          reference_name: "time-series",
        }),
      },
    ],
    toolResults: [
      {
        toolName: "loadSkillReference",
        output: timeSeries,
      },
    ],
  });

  assert.equal(taskState.loadedSkillReferenceChecks?.length, 1);
  assert.equal(
    taskState.loadedSkillReferenceChecks?.[0]?.reference_key,
    "data-format-skills/time-series",
  );
});

test("tool runtime seeds skill gates from persisted task-state checks", async () => {
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
    initialLoadedSkillReferenceChecks: [timeCheck],
  });

  const result = await executeTool(runtime.tools.upsertQuery, {
    skill_reference: timeCheck.reference_key,
    query: timeSeriesQuery(),
  });

  assert.match(
    (result as { summary: string }).summary,
    /Staged query "GMV Trend"/,
  );
});

test("trace replay: explore first, then confirmed GMV trend can author with loaded skills", async () => {
  const lineReference = await loadAuthoringSkillReference(
    "echarts-skills",
    "line-timeseries",
  );
  const timeReference = await loadAuthoringSkillReference(
    "data-format-skills",
    "time-series",
  );
  assert.ok(lineReference?.check);
  assert.ok(timeReference?.check);

  const replay = replayAuthoringTraceFixture([
    { kind: "user", text: "先帮我看看有哪些可用数据", intent: "explore" },
    {
      kind: "tool-step",
      toolCalls: [{ toolName: "getSchemaByDatasource" }],
      toolResults: [{ toolName: "getSchemaByDatasource", output: { ok: true } }],
      visibleText:
        "销售规模数据可以看 GMV 和订单数，适合先做经营趋势。",
    },
    {
      kind: "user",
      text: "可以 先搭建一个每周 GMV 趋势报表",
    },
    {
      kind: "tool-step",
      toolCalls: [
        {
          toolName: "loadSkillReference",
          input: JSON.stringify({
            skill_id: "echarts-skills",
            reference_name: "line-timeseries",
          }),
        },
        {
          toolName: "loadSkillReference",
          input: JSON.stringify({
            skill_id: "data-format-skills",
            reference_name: "time-series",
          }),
        },
      ],
      toolResults: [
        { toolName: "loadSkillReference", output: lineReference },
        { toolName: "loadSkillReference", output: timeReference },
      ],
    },
    {
      kind: "tool-step",
      toolCalls: [
        { toolName: "upsertQuery" },
        { toolName: "upsertView" },
        { toolName: "upsertBinding" },
      ],
      toolResults: [
        { toolName: "upsertQuery", output: { ok: true } },
        { toolName: "upsertView", output: { ok: true } },
        { toolName: "upsertBinding", output: { ok: true } },
      ],
      visibleText: "已生成每周 GMV 趋势草稿。",
    },
  ]);

  assert.equal(replay.decisions[0]?.mode, "explore");
  assert.equal(replay.decisions[0]?.activeTools.includes("upsertView"), false);
  assert.equal(replay.decisions[1]?.mode, "author-dashboard");
  assert.equal(replay.decisions[1]?.activeTools.includes("upsertView"), true);
  assert.equal(replay.taskState?.phase, "drafting");
  assert.deepEqual(
    replay.taskState?.loadedSkillReferenceChecks?.map((check) => check.reference_key),
    ["echarts-skills/line-timeseries", "data-format-skills/time-series"],
  );
  assert.equal(replay.taskState?.lastBlockerQuestion, undefined);
  for (const text of replay.visibleTexts) {
    assert.doesNotMatch(text, /先确认.*视图结构/);
    assert.doesNotMatch(text, /再补充.*查询与绑定/);
    assert.doesNotMatch(text, /请求审批/);
  }
});

test("trace replay: tool gate failure feeds recovery prompt instead of hiding as success", () => {
  const replay = replayAuthoringTraceFixture([
    { kind: "user", text: "创建每周 GMV 趋势" },
    {
      kind: "tool-step",
      toolCalls: [{ toolName: "upsertView", input: { view_spec: {} } }],
      toolResults: [
        {
          toolName: "upsertView",
          error: new AuthoringToolGateError({
            code: "missing_skill",
            userSafeSummary:
              "upsertView requires exactly one loaded ECharts skill reference.",
            recoveryHint:
              "Load the line-timeseries ECharts skill before retrying.",
            retryable: true,
          }),
        },
      ],
    },
    { kind: "user", text: "继续" },
  ]);

  assert.equal(replay.stepHistory.at(-1)?.outcome, "error");
  assert.equal(replay.taskState?.phase, "recovering_tool_error");
  assert.equal(replay.taskState?.lastFailedTool?.code, "missing_skill");
  assert.equal(replay.decisions.at(-1)?.activeTools.includes("upsertView"), true);

  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
    taskState: replay.taskState,
  });
  assert.match(prompt, /code: missing_skill/i);
  assert.match(prompt, /line-timeseries ECharts skill/i);
});

test("compose readiness waits for bindings on newly staged data-backed views", () => {
  const partialDraft: AuthoringChatSessionPayload["prompt"]["workingDraft"] = {
    dashboardSpec: {
      ...baseDocument().dashboard_spec,
      views: [
        {
          id: "v_gmv_trend",
          title: "GMV Trend",
          renderer: lineViewSpec().renderer,
        },
      ],
      layout: {
        desktop: {
          cols: 12,
          row_height: 80,
          items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
        },
      },
    },
    queryDefs: [timeSeriesQuery()],
    dirtyViewIds: ["v_gmv_trend"],
    dirtyQueryIds: ["q_gmv_trend"],
    dirtyBindingIds: [],
    layoutTouched: true,
    stagedAt: "2026-04-27T00:00:00.000Z",
  };

  assert.equal(
    draftNeedsBindingBeforeCompose({
      dashboard: baseDocument(),
      draft: partialDraft,
    }),
    true,
  );
  assert.equal(
    isDraftReadyForCompose({
      dashboard: baseDocument(),
      draft: partialDraft,
    }),
    false,
  );

  const boundDraft = {
    ...partialDraft,
    bindings: [
      {
        id: "b_gmv_x",
        view_id: "v_gmv_trend",
        slot_id: "x",
        query_id: "q_gmv_trend",
        mode: "live" as const,
        param_mapping: {},
        result_selector: "rows[].bucket_date",
      },
      {
        id: "b_gmv_y",
        view_id: "v_gmv_trend",
        slot_id: "y",
        query_id: "q_gmv_trend",
        mode: "live" as const,
        param_mapping: {},
        result_selector: "rows[].metric_value",
      },
    ],
    dirtyBindingIds: ["b_gmv_x", "b_gmv_y"],
  };

  assert.equal(
    isDraftReadyForCompose({
      dashboard: baseDocument(),
      draft: boundDraft,
    }),
    true,
  );
});

test("draft completion guard forces compose only after a complete staged write", () => {
  const partialDraft: AuthoringChatSessionPayload["prompt"]["workingDraft"] = {
    dashboardSpec: {
      ...baseDocument().dashboard_spec,
      views: [
        {
          id: "v_gmv_trend",
          title: "GMV Trend",
          renderer: lineViewSpec().renderer,
        },
      ],
      layout: {
        desktop: {
          cols: 12,
          row_height: 80,
          items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
        },
      },
    },
    queryDefs: [timeSeriesQuery()],
    dirtyViewIds: ["v_gmv_trend"],
    dirtyQueryIds: ["q_gmv_trend"],
    dirtyBindingIds: [],
    layoutTouched: true,
    stagedAt: "2026-04-27T00:00:00.000Z",
  };

  const conversation = {
    latestDraftOutput: null,
    approvalState: "none" as const,
  };

  assert.equal(
    resolveMechanicalDraftCompletionTool({
      dashboard: baseDocument(),
      draft: {
        queryDefs: [timeSeriesQuery()],
        dirtyViewIds: [],
        dirtyQueryIds: ["q_gmv_trend"],
        dirtyBindingIds: [],
        layoutTouched: false,
        stagedAt: "2026-04-27T00:00:00.000Z",
      },
      conversation,
      stepHistoryInTurn: [{ toolName: "upsertQuery", outcome: "ok" }],
    }),
    null,
  );

  assert.equal(
    resolveMechanicalDraftCompletionTool({
      dashboard: baseDocument(),
      draft: partialDraft,
      conversation,
      stepHistoryInTurn: [{ toolName: "upsertView", outcome: "ok" }],
    }),
    null,
  );

  assert.equal(
    resolveMechanicalDraftCompletionTool({
      dashboard: baseDocument(),
      draft: {
        ...partialDraft,
        bindings: [
          {
            id: "b_gmv_x",
            view_id: "v_gmv_trend",
            slot_id: "x",
            query_id: "q_gmv_trend",
            mode: "live",
            param_mapping: {},
            result_selector: "rows[].bucket_date",
          },
          {
            id: "b_gmv_y",
            view_id: "v_gmv_trend",
            slot_id: "y",
            query_id: "q_gmv_trend",
            mode: "live",
            param_mapping: {},
            result_selector: "rows[].metric_value",
          },
        ],
        dirtyBindingIds: ["b_gmv_x", "b_gmv_y"],
      },
      conversation,
      stepHistoryInTurn: [
        { toolName: "upsertView", outcome: "ok" },
        { toolName: "upsertBinding", outcome: "ok" },
      ],
    }),
    "composePatch",
  );
});

test("draft completion guard requests apply after compose output", () => {
  assert.equal(
    resolveMechanicalDraftCompletionTool({
      dashboard: baseDocument(),
      draft: null,
      conversation: {
        approvalState: "none",
        latestDraftOutput: {
          suggestion: {
            id: "patch_gmv",
            kind: "data",
            title: "GMV Trend",
            summary: "Prepared GMV trend.",
            patch: { summary: "Add GMV trend.", operations: [] },
          },
          approval: {
            required: true,
            status: "pending",
            summary: "Approve GMV trend.",
            operation_count: 0,
            affected_paths: [],
          },
          repair: {
            status: "not-needed",
            attempted: 0,
            max_attempts: 0,
            repaired: false,
            notes: [],
          },
        },
      },
      stepHistoryInTurn: [{ toolName: "composePatch", outcome: "ok" }],
    }),
    "applyPatch",
  );

  assert.equal(
    resolveMechanicalDraftCompletionTool({
      dashboard: baseDocument(),
      draft: null,
      conversation: {
        approvalState: "requested",
        latestDraftOutput: {
          suggestion: {
            id: "patch_gmv",
            kind: "data",
            title: "GMV Trend",
            summary: "Prepared GMV trend.",
            patch: { summary: "Add GMV trend.", operations: [] },
          },
          approval: {
            required: true,
            status: "pending",
            summary: "Approve GMV trend.",
            operation_count: 0,
            affected_paths: [],
          },
          repair: {
            status: "not-needed",
            attempted: 0,
            max_attempts: 0,
            repaired: false,
            notes: [],
          },
        },
      },
      stepHistoryInTurn: [{ toolName: "composePatch", outcome: "ok" }],
    }),
    null,
  );
});

test("composePatch gate rejects newly staged data-backed views without bindings", async () => {
  const document = baseDocument();
  const workingDraft = createWorkingDraftState(null);
  workingDraft.dashboardSpec = {
    ...document.dashboard_spec,
    views: [
      {
        id: "v_gmv_trend",
        title: "GMV Trend",
        renderer: lineViewSpec().renderer,
      },
    ],
    layout: {
      desktop: {
        cols: 12,
        row_height: 80,
        items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
      },
      mobile: {
        cols: 4,
        row_height: 80,
        items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
      },
    },
  };
  workingDraft.queryDefs = [timeSeriesQuery()];
  workingDraft.dirtyViewIds.add("v_gmv_trend");
  workingDraft.dirtyQueryIds.add("q_gmv_trend");
  workingDraft.layoutTouched = true;

  const composePatch = buildComposePatchTool({
    dashboard: document,
    dependencies: createValidationOnlyAuthoringDependencies(),
    workingDraft,
    setLatestProposalMeta: () => {},
    buildCandidateDocument,
  });

  await assert.rejects(
    () => executeTool(composePatch, {}),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "binding_mismatch");
      assert.match(error.recoveryHint, /upsertBinding/i);
      return true;
    },
  );
});

test("applyPatch gate also rejects incomplete staged data-backed views", async () => {
  const document = baseDocument();
  const workingDraft = createWorkingDraftState(null);
  workingDraft.dashboardSpec = {
    ...document.dashboard_spec,
    views: [
      {
        id: "v_gmv_trend",
        title: "GMV Trend",
        renderer: lineViewSpec().renderer,
      },
    ],
    layout: {
      desktop: {
        cols: 12,
        row_height: 80,
        items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
      },
      mobile: {
        cols: 4,
        row_height: 80,
        items: [{ i: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
      },
    },
  };
  workingDraft.queryDefs = [timeSeriesQuery()];
  workingDraft.dirtyViewIds.add("v_gmv_trend");
  workingDraft.dirtyQueryIds.add("q_gmv_trend");
  workingDraft.layoutTouched = true;

  const applyPatch = buildApplyPatchTool({
    dashboard: document,
    dependencies: createValidationOnlyAuthoringDependencies(),
    messages: [],
    workingDraft,
    resetWorkingDraft: () => {
      throw new Error("applyPatch should not reset an incomplete draft");
    },
    recordMutation: () => {},
    getLatestProposalMeta: () => ({
      suggestionId: "patch-test",
      kind: "data",
      title: "GMV Trend",
      summary: "Prepared GMV trend.",
      patchSummary: "Patch summary.",
    }),
    buildCandidateDocument,
  });

  await assert.rejects(
    () => executeTool(applyPatch, { suggestion_id: "patch-test" }),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "binding_mismatch");
      assert.match(error.recoveryHint, /upsertBinding/i);
      return true;
    },
  );
});

test("all first-class authoring skill references expose valid skill checks", async () => {
  const references = [
    ["data-format-skills", "time-series", "data-format"],
    ["data-format-skills", "category-series", "data-format"],
    ["data-format-skills", "scalar-kpi", "data-format"],
    ["data-format-skills", "detail-rows", "data-format"],
    ["echarts-skills", "line-timeseries", "echarts-view"],
    ["echarts-skills", "bar-category", "echarts-view"],
    ["echarts-skills", "kpi-text", "echarts-view"],
    ["echarts-skills", "kpi-gauge", "echarts-view"],
  ];

  for (const [skillId, referenceName, expectedKind] of references) {
    const reference = await loadAuthoringSkillReference(skillId, referenceName);
    assert.ok(reference?.check, `${skillId}/${referenceName} should expose check`);
    assert.equal(reference.check.kind, expectedKind);
    assert.equal(reference.check.reference_key, `${skillId}/${referenceName}`);
  }
});

test("skill checks validate a supported time-series view, query, and bindings", async () => {
  const lineCheck = await loadRequiredCheck("echarts-skills", "line-timeseries");
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  assert.equal(lineCheck.kind, "echarts-view");
  assert.equal(timeCheck.kind, "data-format");
  if (lineCheck.kind !== "echarts-view" || timeCheck.kind !== "data-format") {
    throw new Error("unexpected check kind");
  }

  const view = { id: "v_gmv_trend", title: "GMV Trend", renderer: lineViewSpec().renderer };
  const query = timeSeriesQuery();
  assert.deepEqual(validateViewAgainstSkillCheck({ view, check: lineCheck }), []);
  assert.deepEqual(validateQueryAgainstSkillCheck({ query, check: timeCheck }), []);
  assert.deepEqual(
    validateBindingAgainstSkillCheck({
      binding: {
        id: "b_gmv_x",
        view_id: "v_gmv_trend",
        slot_id: "x",
        query_id: "q_gmv_trend",
        param_mapping: {},
        result_selector: "rows[].bucket_date",
      },
      view,
      query,
      check: timeCheck,
    }),
    [],
  );
  assert.deepEqual(
    validateBindingAgainstSkillCheck({
      binding: {
        id: "b_gmv_y",
        view_id: "v_gmv_trend",
        slot_id: "y",
        query_id: "q_gmv_trend",
        param_mapping: {},
        result_selector: "rows[].metric_value",
      },
      view,
      query,
      check: timeCheck,
    }),
    [],
  );
});

test("write tools reject unloaded or mismatched skill references", async () => {
  const lineCheck = await loadRequiredCheck("echarts-skills", "line-timeseries");
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  const detailRowsCheck = await loadRequiredCheck("data-format-skills", "detail-rows");

  await assert.rejects(
    () =>
      executeTool(makeToolHarness([]).upsertView, {
        request: "Create GMV trend",
        view_spec: lineViewSpec(),
      }),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "missing_skill");
      assert.equal(error.retryable, true);
      assert.match(error.message, /requires exactly one loaded ECharts skill reference/i);
      assert.match(error.recoveryHint, /load/i);
      return true;
    },
  );

  await assert.rejects(
    () =>
      executeTool(makeToolHarness([lineCheck, timeCheck]).upsertView, {
        request: "Create GMV trend",
        skill_reference: lineCheck.reference_key,
        view_spec: lineViewSpec("bar"),
      }),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "schema_mismatch");
      assert.equal(error.retryable, true);
      assert.match(error.message, /series\.type must include line/i);
      return true;
    },
  );

  await assert.rejects(
    () =>
      executeTool(makeToolHarness([timeCheck]).upsertQuery, {
        skill_reference: timeCheck.reference_key,
        query: {
          ...timeSeriesQuery(),
          output: {
            kind: "rows",
            schema: [{ name: "metric_value", type: "number", nullable: false }],
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "schema_mismatch");
      assert.match(error.message, /rows output must include a time field/i);
      return true;
    },
  );

  await assert.rejects(
    () =>
      executeTool(makeToolHarness([detailRowsCheck]).upsertQuery, {
        skill_reference: detailRowsCheck.reference_key,
        query: {
          ...timeSeriesQuery(),
          output: {
            kind: "rows",
            schema: [{ name: "order_id", type: "string", nullable: false }],
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "unsupported_view_type");
      assert.equal(error.retryable, false);
      assert.match(error.message, /data-only/i);
      return true;
    },
  );
});

test("write tools can create a supported line time-series draft when matching skills are loaded", async () => {
  const lineCheck = await loadRequiredCheck("echarts-skills", "line-timeseries");
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  const harness = makeToolHarness([lineCheck, timeCheck]);

  await executeTool(harness.upsertQuery, {
    skill_reference: timeCheck.reference_key,
    query: timeSeriesQuery(),
  });
  await executeTool(harness.upsertView, {
    request: "Create weekly GMV trend",
    skill_reference: lineCheck.reference_key,
    view_spec: lineViewSpec(),
  });
  await executeTool(harness.upsertBinding, {
    skill_reference: timeCheck.reference_key,
    binding: {
      id: "b_gmv_x",
      view_id: "v_gmv_trend",
      slot_id: "x",
      query_id: "q_gmv_trend",
      param_mapping: {},
      result_selector: "rows[].bucket_date",
    },
  });
  await executeTool(harness.upsertBinding, {
    skill_reference: timeCheck.reference_key,
    binding: {
      id: "b_gmv_y",
      view_id: "v_gmv_trend",
      slot_id: "y",
      query_id: "q_gmv_trend",
      param_mapping: {},
      result_selector: "rows[].metric_value",
    },
  });

  const candidate = harness.candidate();
  assert.equal(candidate.dashboard_spec.views.length, 1);
  assert.equal(candidate.query_defs.length, 1);
  assert.equal(candidate.bindings.length, 2);
  assert.equal(harness.mutations.length, 4);
});

test("binding gate rejects selector output that does not match slot semantics", async () => {
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  const document = baseDocument();
  document.dashboard_spec.views = [
    { id: "v_gmv_trend", title: "GMV Trend", renderer: lineViewSpec().renderer },
  ];
  document.query_defs = [timeSeriesQuery()];
  const harness = makeToolHarness([timeCheck], document);

  await assert.rejects(
    () =>
      executeTool(harness.upsertBinding, {
        skill_reference: timeCheck.reference_key,
        binding: {
          id: "b_bad_x",
          view_id: "v_gmv_trend",
          slot_id: "x",
          query_id: "q_gmv_trend",
          param_mapping: {},
          result_selector: "rows[].metric_value",
        },
      }),
    /expects a time field/i,
  );
});

test("write-tool schema failure records recovery state", () => {
  const taskState = updateTaskStateFromToolStep({
    previous: {
      phase: "drafting",
      loadedSkillReferences: [],
      updatedAt: "2026-04-25T00:00:00.000Z",
    },
    toolCalls: [{ toolName: "upsertView", input: { view_spec: {} } }],
    toolResults: [],
  });

  assert.equal(taskState.phase, "recovering_tool_error");
  assert.equal(taskState.lastFailedTool?.toolName, "upsertView");
  assert.equal(taskState.lastFailedTool?.attemptCount, 1);
});

test("structured tool-gate errors are persisted for recovery", () => {
  const taskState = updateTaskStateFromToolStep({
    previous: {
      phase: "drafting",
      loadedSkillReferences: [],
      updatedAt: "2026-04-25T00:00:00.000Z",
    },
    toolCalls: [{ toolName: "upsertView", input: { view_spec: {} } }],
    toolResults: [
      {
        toolName: "upsertView",
        error: new AuthoringToolGateError({
          code: "missing_skill",
          userSafeSummary:
            "upsertView requires exactly one loaded ECharts skill reference.",
          recoveryHint:
            "Load the matching ECharts skill reference before retrying.",
          retryable: true,
        }),
      },
    ],
  });

  assert.equal(taskState.phase, "recovering_tool_error");
  assert.equal(taskState.lastFailedTool?.toolName, "upsertView");
  assert.equal(taskState.lastFailedTool?.code, "missing_skill");
  assert.equal(taskState.lastFailedTool?.retryable, true);
  assert.match(
    taskState.lastFailedTool?.recoveryHint ?? "",
    /matching ECharts skill/i,
  );
});

test("user-turn task state preserves goal summary on short operational replies", () => {
  const taskState = updateTaskStateFromUserTurn({
    previous: {
      phase: "ready_to_draft",
      goalSummary: "每周 GMV 趋势",
      loadedSkillReferences: [],
      updatedAt: "2026-04-25T00:00:00.000Z",
    },
    latestUserText: "创建呀",
  });

  assert.equal(taskState.phase, "ready_to_draft");
  assert.equal(taskState.goalSummary, "每周 GMV 趋势");
  assert.equal(taskState.lastRouteDecision, undefined);
});

test("user-turn task state records substantive new goals without route advice", () => {
  const taskState = updateTaskStateFromUserTurn({
    previous: {
      phase: "idle",
      loadedSkillReferences: [],
      updatedAt: "2026-04-25T00:00:00.000Z",
    },
    latestUserText: "我想看每周 GMV 趋势变化",
  });

  assert.equal(taskState.phase, "idle");
  assert.equal(taskState.goalSummary, "我想看每周 GMV 趋势变化");
  assert.equal(taskState.lastRouteDecision, undefined);
});

test("user-turn task state reflects working draft and pending approval facts", () => {
  const drafting = updateTaskStateFromUserTurn({
    previous: {
      phase: "ready_to_draft",
      loadedSkillReferences: [],
      updatedAt: "2026-04-25T00:00:00.000Z",
    },
    latestUserText: "继续",
    hasWorkingDraft: true,
  });
  assert.equal(drafting.phase, "drafting");

  const approval = updateTaskStateFromUserTurn({
    previous: drafting,
    latestUserText: "继续",
    hasPendingApproval: true,
  });
  assert.equal(approval.phase, "awaiting_approval");
});

test("repair prompt is generic and does not carry chart examples", () => {
  const prompt = buildRepairToolPrompt({
    toolName: "upsertView",
    validationError: "view_spec.renderer is required",
    jsonSchema: { type: "object" },
    invalidInput: { view_spec: { title: "Bad" } },
  });

  assert.match(prompt, /Tool contract:/);
  assert.match(prompt, /Strict JSON schema:/);
  assert.match(prompt, /Repair scope is structural/i);
  assert.match(prompt, /slot semantics/i);
  assert.match(prompt, /Do not redesign the report/i);
  assert.doesNotMatch(prompt, /KPI renderer/i);
  assert.doesNotMatch(prompt, /three KPI cards/i);
  assert.doesNotMatch(prompt, /xAxis\.data/i);
});

test("echarts skills defer canonical tool contracts and avoid business table examples", async () => {
  const skill = await readFile(
    "src/ai/authoring/skills/echarts-skills/SKILL.md",
    "utf8",
  );
  assert.match(skill, /Tool Contract Boundary/);
  assert.doesNotMatch(skill, /Canonical Query Contract/i);
  assert.doesNotMatch(skill, /upsertQuery accepts only/i);
  assert.doesNotMatch(skill, /Canonical Binding Contract/i);

  const references = [
    "bar-category",
    "kpi-gauge",
    "kpi-text",
    "line-timeseries",
  ];
  for (const reference of references) {
    const content = await readFile(
      `src/ai/authoring/skills/echarts-skills/references/${reference}.md`,
      "utf8",
    );
    assert.doesNotMatch(content, /public\.sales_/i);
  }
});

test("main prompt keeps high-level behavior and omits schema contract internals", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
    taskState: {
      phase: "recovering_tool_error",
      loadedSkillReferences: ["data-format-skills/time-series"],
      lastFailedTool: {
        toolName: "upsertView",
        errorSummary: "renderer missing",
        code: "schema_mismatch",
        recoveryHint: "Regenerate view_spec using the loaded ECharts skill.",
        retryable: true,
        attemptCount: 1,
        lastOccurredAt: "2026-04-25T00:00:00.000Z",
      },
      updatedAt: "2026-04-25T00:00:00.000Z",
    },
  });

  assert.match(prompt, /Tool input contracts live in tool descriptions and schemas/i);
  assert.match(prompt, /Do not treat advisory or exploration questions as creation requests/i);
  assert.match(prompt, /Do not call write tools for advisory-only questions/i);
  assert.match(prompt, /A concrete visualization request/i);
  assert.match(prompt, /Loading a skill or skill reference is never a completed response/i);
  assert.match(prompt, /only stage an internal working draft/i);
  assert.match(prompt, /Do not end a concrete creation turn after only these staging tools/i);
  assert.match(prompt, /Current task state:/);
  assert.match(prompt, /last failed write tool: upsertView/i);
  assert.match(prompt, /code: schema_mismatch/i);
  assert.match(prompt, /Regenerate view_spec/i);
  assert.doesNotMatch(prompt, /Canonical QueryDef is strict/i);
  assert.doesNotMatch(prompt, /canonical View shape/i);
  assert.doesNotMatch(prompt, /canonical Binding shape/i);
});

test("skill loading tool descriptions make loading non-terminal for creation", () => {
  const skillTool = buildLoadSkillTool({
    skillCatalog: new Map(),
    loadSkill: async () => null,
  });
  const referenceTool = buildLoadSkillReferenceTool({
    skillCatalog: new Map(),
    loadSkillReference: async () => null,
  });

  assert.match(skillTool.description ?? "", /preparatory read tool/i);
  assert.match(skillTool.description ?? "", /not a final action/i);
  assert.match(skillTool.description ?? "", /continue with the matching skill reference and write tools/i);
  assert.match(referenceTool.description ?? "", /preparatory read tool/i);
  assert.match(referenceTool.description ?? "", /not a final action/i);
  assert.match(referenceTool.description ?? "", /continue with upsertQuery, upsertView, and upsertBinding/i);
});

test("write tool contracts separate advisory questions from active creation", () => {
  for (const contract of [
    UPSERT_QUERY_TOOL_CONTRACT,
    UPSERT_VIEW_TOOL_CONTRACT,
    UPSERT_BINDING_TOOL_CONTRACT,
  ]) {
    assert.match(contract, /active dashboard creation\/edit/i);
    assert.match(contract, /Do not call it for discovery, advisory, planning/i);
    assert.match(contract, /how should we analyze this/i);
    assert.match(contract, /latest user turn requests a concrete dashboard output/i);
    assert.match(contract, /not a user-visible completed report/i);
  }

  assert.match(
    UPSERT_QUERY_TOOL_CONTRACT,
    /Do not stage exploratory queries just to answer what analysis is possible/i,
  );
  assert.match(
    UPSERT_BINDING_TOOL_CONTRACT,
    /When every required view slot is bound, call composePatch and then applyPatch/i,
  );
});

test("user-visible fixture text does not expose internal sequencing", () => {
  const visibleTexts = [
    "我会用销售周报数据生成一个销售总览草稿，确认后再写入画布。",
    "已生成草稿，请检查指标口径。",
  ];

  for (const text of visibleTexts) {
    assert.doesNotMatch(text, /先确认.*视图结构/);
    assert.doesNotMatch(text, /再补充.*查询与绑定/);
    assert.doesNotMatch(text, /请求审批/);
  }
});
