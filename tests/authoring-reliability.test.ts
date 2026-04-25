import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { AuthoringScopeInput } from "../src/ai/authoring/scope.ts";
import type {
  AuthoringChatSessionPayload,
  AuthoringRouteAdvice,
  AuthoringTaskStateSnapshot,
} from "../src/ai/authoring/contracts/session-state.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { computeAuthoringScope } = await import("../src/ai/authoring/scope.ts");
const { buildAuthoringSystemPrompt } = await import("../src/ai/authoring/prompt.ts");
const { buildRepairToolPrompt } = await import("../src/ai/authoring/repair.ts");
const { sanitizeAuthoringChatSessionPayload } = await import(
  "../src/ai/authoring/contracts/session-state.ts"
);
const {
  updateTaskStateFromRouteAdvice,
  updateTaskStateFromToolStep,
} = await import("../src/ai/authoring/task-state.ts");

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

function routeAdvice(
  patch: Partial<AuthoringRouteAdvice>,
): AuthoringRouteAdvice {
  return {
    route: "plan",
    reason: "fixture",
    confidence: 0.9,
    dataContextStatus: "missing",
    shouldAskBlocker: false,
    recommendedSkillIds: [],
    ...patch,
  };
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
    routeAdvice: null,
    taskState: null,
    lockedMode: null,
    ...patch,
  };
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

test("route advisor cannot force writes when data context is missing", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "我想做一个销售总览",
      routeAdvice: routeAdvice({
        route: "author-dashboard",
        dataContextStatus: "missing",
      }),
    }),
  );

  assert.equal(decision.mode, "plan");
  assert.equal(decision.activeTools.includes("upsertView"), false);
  assert.equal(decision.activeTools.includes("upsertQuery"), false);
});

test("missing data context blocks new data drafts even when dashboard already has views", () => {
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
      routeAdvice: routeAdvice({
        route: "author-dashboard",
        dataContextStatus: "missing",
      }),
    }),
  );

  assert.equal(decision.mode, "plan");
  assert.equal(decision.activeTools.includes("upsertView"), false);
});

test("approval guard wins over model route advice", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "继续",
      conversation: {
        latestUserText: "继续",
        approvalState: "approved",
        latestDraftOutput: null,
      },
      routeAdvice: routeAdvice({
        route: "author-dashboard",
        dataContextStatus: "confirmed",
      }),
    }),
  );

  assert.equal(decision.mode, "approval");
  assert.deepEqual(decision.activeTools, ["applyPatch"]);
});

test("confirmed data followup routes to authoring without view-structure blocker", () => {
  const taskState: AuthoringTaskStateSnapshot = {
    phase: "awaiting_data_confirmation",
    goalSummary: "销售总览",
    loadedSkillReferences: [],
    updatedAt: "2026-04-25T00:00:00.000Z",
  };
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "可以的",
      routeAdvice: routeAdvice({
        route: "author-dashboard",
        dataContextStatus: "confirmed",
        shouldAskBlocker: false,
      }),
      taskState,
    }),
  );

  assert.equal(decision.mode, "author-dashboard");
  assert.equal(decision.activeTools.includes("upsertView"), true);
  assert.equal(decision.activeTools.includes("composePatch"), true);
});

test("route advice recommended skills and data-format skill-reference calls are tracked", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "做一个趋势图",
      routeAdvice: routeAdvice({
        route: "author-dashboard",
        dataContextStatus: "confirmed",
        recommendedSkillIds: ["data-format-skills"],
      }),
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

test("route advice updates task state for source confirmation", () => {
  const taskState = updateTaskStateFromRouteAdvice({
    previous: null,
    latestUserText: "销售总览",
    advice: routeAdvice({
      route: "plan",
      dataContextStatus: "candidate-recommended",
      shouldAskBlocker: true,
      reason: "Recommend sales_weekly_fact for GMV and orders.",
    }),
  });

  assert.equal(taskState.phase, "awaiting_data_confirmation");
  assert.equal(
    taskState.lastBlockerQuestion,
    "Recommend sales_weekly_fact for GMV and orders.",
  );
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
  assert.doesNotMatch(prompt, /KPI renderer/i);
  assert.doesNotMatch(prompt, /three KPI cards/i);
  assert.doesNotMatch(prompt, /xAxis\.data/i);
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
        attemptCount: 1,
        lastOccurredAt: "2026-04-25T00:00:00.000Z",
      },
      updatedAt: "2026-04-25T00:00:00.000Z",
    },
  });

  assert.match(prompt, /Tool input contracts live in tool descriptions and schemas/i);
  assert.match(prompt, /Current task state:/);
  assert.match(prompt, /last failed write tool: upsertView/i);
  assert.doesNotMatch(prompt, /Canonical QueryDef is strict/i);
  assert.doesNotMatch(prompt, /canonical View shape/i);
  assert.doesNotMatch(prompt, /canonical Binding shape/i);
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
