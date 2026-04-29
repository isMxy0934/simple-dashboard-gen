import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import type { AuthoringScopeInput } from "../src/ai/authoring/runtime/capability-scope.ts";
import type {
  AuthoringChatSessionPayload,
} from "../src/ai/authoring/contracts/session.ts";
import type { AuthoringMessage } from "../src/ai/authoring/contracts/tool-io.ts";
import type { MutationDescriptor } from "../src/ai/authoring/messages/invalidate-on-mutation.ts";
import type { AuthoringSkillReferenceCheck } from "../src/ai/authoring/contracts/skill.ts";
import type {
  DashboardDocument,
  DashboardView,
  QueryDef,
} from "../src/contracts/dashboard.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const { computeAuthoringScope, resolveAuthoringIntent } = await import(
  "../src/ai/authoring/runtime/capability-scope.ts"
);
const { buildAuthoringSystemPrompt } = await import("../src/ai/authoring/messages/system-prompt.ts");
const { buildAuthoringContextBlock } = await import(
  "../src/ai/authoring/messages/context-block.ts"
);
const { buildRepairToolPrompt } = await import("../src/ai/authoring/messages/repair-prompt.ts");
const { sanitizeAuthoringChatSessionPayload } = await import(
  "../src/ai/authoring/runtime/session-sanitize.ts"
);
const { isAgentChatRequestBody } = await import(
  "../src/server/authoring/chat-request-schema.ts"
);
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
const { buildDraftStatus } = await import(
  "../src/ai/authoring/tools/draft-status.ts"
);
const {
  buildLoadSkillReferenceTool,
  buildLoadSkillTool,
} = await import("../src/ai/authoring/tools/shared-tools.ts");
const { buildAuthoringTools } = await import("../src/ai/authoring/tools/factory.ts");
const { createWorkingDraftState } = await import(
  "../src/ai/authoring/tools/draft-state.ts"
);
const { createValidationOnlyAuthoringDependencies } = await import(
  "../src/ai/authoring/runtime/dependencies.ts"
);
const {
  buildCandidateDocument,
  buildDocumentFingerprint,
} = await import("../src/ai/authoring/tools/candidate-document.ts");
const {
  validateBindingAgainstSkillCheck,
  validateQueryAgainstSkillCheck,
  validateViewAgainstSkillCheck,
} = await import("../src/ai/authoring/contracts/skill.ts");
const { AuthoringToolGateError } = await import(
  "../src/ai/authoring/contracts/errors.ts"
);
const {
  draftNeedsBindingBeforeCompose,
  isDraftReadyForCompose,
} = await import("../src/ai/authoring/tools/compose-readiness.ts");
const {
  UPSERT_BINDING_TOOL_CONTRACT,
  UPSERT_QUERY_TOOL_CONTRACT,
  UPSERT_VIEW_TOOL_CONTRACT,
} = await import("../src/ai/authoring/tools/tool-contracts.ts");
const {
  AUTHORING_INTERRUPTED_TOOL_ERROR,
  finalizeIncompleteToolCalls,
} = await import(
  "../src/ai/authoring/messages/incomplete-tools.ts"
);
const { stripAuthoringMessagesForModel } = await import(
  "../src/ai/authoring/messages/client-parts.ts"
);
const { findLatestDraftOutput, findLatestWorkflow } = await import(
  "../src/ai/authoring/messages/inspection.ts"
);
const { pruneResolvedPatchProposalPayloads } = await import(
  "../src/ai/authoring/messages/message-prune.ts"
);
const {
  getAuthoringTerminalNotice,
  getAuthoringWorkingIndicator,
} = await import(
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
    lockedProfile: null,
    ...patch,
  };
}

function extractContextEnvelope(markdown: string) {
  const marker = "## AuthoringContextEnvelope\n";
  const start = markdown.indexOf(marker);
  assert.notEqual(start, -1);
  const afterMarker = markdown.slice(start + marker.length);
  const [json] = afterMarker.split("\n\n");
  return JSON.parse(json) as {
    scope_resolution: {
      effective_scope: "dashboard" | "focused";
      selected_view_id: string | null;
    };
    workflow_v2?: {
      active_goal?: {
        id?: string;
        chart_type?: string | null;
      } | null;
      action?: unknown;
    } | null;
    lifecycle?: unknown;
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
  const stepHistory: AuthoringScopeInput["stepHistoryInTurn"] = [];
  const decisions: ReturnType<typeof computeAuthoringScope>[] = [];
  const visibleTexts: string[] = [];

  for (const event of events) {
    if (event.kind === "user") {
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

    for (const call of event.toolCalls) {
      const matchingResults =
        event.toolResults?.filter((result) => result.toolName === call.toolName) ??
        [];
      stepHistory.push({
        toolName: call.toolName ?? "",
        outcome: matchingResults.some(
          (result) =>
            result.error === undefined &&
            !(
              call.toolName === "runCheck" &&
              typeof result.output === "object" &&
              result.output !== null &&
              "status" in result.output &&
              result.output.status === "error"
            ),
        )
          ? "ok"
          : "error",
      });
    }
    if (event.visibleText) {
      visibleTexts.push(event.visibleText);
    }
  }

  return { decisions, stepHistory, visibleTexts };
}

test("session sanitizer drops legacy taskState and preserves valid V2 workflow", () => {
  const payload = {
    version: 3,
    sessionId: "sess_1",
    dashboardId: "db_1",
    messages: [],
    updatedAt: "2026-04-25T00:00:00.000Z",
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
      workflowV2: {
        goals: [
          {
            id: "goal_1",
            kind: "create_view",
            status: "awaiting_approval",
            summary: "GMV trend",
            dataMode: "live",
            chartPlan: { chartType: "line" },
            targetRefs: { datasourceId: "testing-db", table: "sales" },
            blockers: [],
            createdFromTurnId: "turn_1",
            createdAt: "2026-04-25T00:00:00.000Z",
            updatedAt: "2026-04-25T00:00:00.000Z",
          },
        ],
        activeGoalId: "goal_1",
        pendingProposalId: "patch_1",
        pendingProposalBaseVersion: 3,
        lastCheckResultId: "legacy_check_id",
      },
      taskState: {
        ["phase"]: "legacy_phase_value",
        goalSummary: "销售总览",
        loadedSkillReferences: ["data-format-skills/time-series"],
        updatedAt: "2026-04-25T00:00:00.000Z",
      },
    },
  } as unknown as AuthoringChatSessionPayload;

  const sanitized = sanitizeAuthoringChatSessionPayload(payload);
  assert.equal("taskState" in sanitized.prompt, false);
  assert.equal(sanitized.version, 4);
  assert.equal(
    sanitized.prompt.workflowV2?.pendingProposalBaseVersion,
    3,
  );
  assert.equal(
    "lastCheckResultId" in (sanitized.prompt.workflowV2 ?? {}),
    false,
  );

  const legacy = {
    ...payload,
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
    },
  } as AuthoringChatSessionPayload;

  assert.equal("taskState" in sanitizeAuthoringChatSessionPayload(legacy).prompt, false);
  assert.equal(
    sanitizeAuthoringChatSessionPayload(legacy).prompt.workflowV2,
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

test("authoring chat request schema accepts valid approval events and rejects malformed ones", () => {
  assert.equal(
    isAgentChatRequestBody({
      sessionId: "sess_approval",
      dashboardId: "db_test",
      dashboard: baseDocument(),
      messages: [],
      baseVersion: 5,
      approvalEvent: {
        proposalId: "patch_1",
        decision: "approve",
        baseVersion: 5,
      },
    }),
    true,
  );

  assert.equal(
    isAgentChatRequestBody({
      sessionId: "sess_approval",
      dashboard: baseDocument(),
      messages: [],
      approvalEvent: {
        proposalId: "patch_1",
        decision: "approve",
        baseVersion: "5",
      },
    }),
    false,
  );
});

test("approval UI sends approvalEvent and applies only tool-applyPatch output", async () => {
  const source = await readFile(
    new URL("../src/web/authoring/agent/use-agent-session.ts", import.meta.url),
    "utf8",
  );
  const approveStart = source.indexOf("async function handleApprovePendingPatch");
  const rejectStart = source.indexOf("async function handleRejectPendingPatch");
  assert.ok(approveStart > 0);
  assert.ok(rejectStart > approveStart);

  const approveHandler = source.slice(approveStart, rejectStart);
  assert.match(approveHandler, /pendingApprovalEventRef\.current = \{[\s\S]*decision: "approve"/);
  assert.match(approveHandler, /sendMessage\(\{ text: "Confirm and apply the staged patch\." \}\)/);
  assert.doesNotMatch(approveHandler, /replaceDashboard\(/);
  assert.doesNotMatch(approveHandler, /onAppliedDashboard\(/);

  assert.match(source, /findLatestApplyPatchOutput/);
  assert.match(source, /const appliedDoc = output\?\.dashboard/);

  const rejectHandler = source.slice(rejectStart);
  assert.match(rejectHandler, /pendingApprovalEventRef\.current = \{[\s\S]*decision: "reject"/);
  assert.match(rejectHandler, /sendMessage\(\{ text: "Reject the staged patch\." \}\)/);
  assert.match(
    rejectHandler,
    /pruneResolvedPatchProposalPayloads\(prev, \{ mode: "all_unresolved" \}\)/,
  );
  assert.doesNotMatch(rejectHandler, /replaceDashboard\(/);
  assert.doesNotMatch(rejectHandler, /onAppliedDashboard\(/);
});

test("v2 reject persistence wiring clears draft state and preserves workflow", async () => {
  const serviceSource = await readFile(
    new URL("../src/server/authoring/chat-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(serviceSource, /getRejectedProposalIdSnapshot/);
  assert.match(serviceSource, /rejectedProposalId: getRejectedProposalIdSnapshot\(\)/);

  const orchestratorSource = await readFile(
    new URL("../src/server/authoring/chat-session-orchestrator.ts", import.meta.url),
    "utf8",
  );
  assert.match(orchestratorSource, /const hasAcceptedV2Reject = Boolean\(input\.rejectedProposalId\)/);
  assert.match(orchestratorSource, /const hasLegacyReject =\s*!hasAcceptedV2Reject && hasRejectedApprovalResponse/);
  assert.match(orchestratorSource, /workingDraft: shouldClearDraftState\s*\?\s*null/);
  assert.match(orchestratorSource, /lastRunCheckState: shouldClearDraftState\s*\?\s*null/);
  assert.doesNotMatch(orchestratorSource, /taskState/);
  assert.match(orchestratorSource, /workflowV2: hasLegacyReject\s*\?\s*null/);
  assert.match(orchestratorSource, /mode: "all_unresolved"/);
});

test("accepted v2 reject pruning removes all composePatch dashboard payloads", () => {
  const draftOutput = (id: string) => ({
    suggestion: {
      id,
      kind: "data",
      title: `Patch ${id}`,
      summary: "Draft patch",
      details: [],
      patch: { summary: "Patch", operations: [] },
      dashboard: baseDocument(),
    },
    approval: {
      required: true,
      status: "pending",
      summary: "Review patch",
      operation_count: 1,
      affected_paths: ["/dashboard_spec/views"],
    },
    repair: {
      status: "not-needed",
      attempted: 0,
      max_attempts: 0,
      repaired: false,
      notes: [],
    },
  });

  const messages = [
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-composePatch",
          state: "output-available",
          toolCallId: "call_1",
          input: {},
          output: draftOutput("patch_old"),
        },
      ],
    },
    {
      id: "a2",
      role: "assistant",
      parts: [
        {
          type: "tool-composePatch",
          state: "output-available",
          toolCallId: "call_2",
          input: {},
          output: draftOutput("patch_current"),
        },
      ],
    },
  ] as AuthoringMessage[];

  assert.equal(findLatestDraftOutput(messages)?.suggestion.id, "patch_current");

  const pruned = pruneResolvedPatchProposalPayloads(messages, {
    mode: "all_unresolved",
  });

  assert.equal(findLatestDraftOutput(pruned), null);
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

test("terminal notice closes ended incomplete or failed tool turns", () => {
  const userOnly = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "做 GMV 趋势" }],
    },
  ] as AuthoringMessage[];

  const unfinishedToolTurn = [
    ...userOnly,
    {
      id: "a1",
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
  ] as AuthoringMessage[];

  assert.equal(
    getAuthoringWorkingIndicator({
      messages: unfinishedToolTurn,
      agentStatus: "ready",
      inactiveMs: 10_000,
    }),
    null,
  );
  assert.equal(
    getAuthoringTerminalNotice({
      messages: unfinishedToolTurn,
      agentStatus: "ready",
    }),
    "interrupted",
  );

  assert.equal(
    getAuthoringTerminalNotice({
      messages: [
        ...userOnly,
        {
          id: "a2",
          role: "assistant",
          parts: [
            {
              type: "tool-upsertView",
              state: "output-error",
              toolCallId: "call_2",
              input: {},
              errorText: "view contract invalid",
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "ready",
    }),
    "toolFailed",
  );

  assert.equal(
    getAuthoringTerminalNotice({
      messages: [
        ...userOnly,
        {
          id: "a3",
          role: "assistant",
          parts: [
            {
              type: "tool-upsertBinding",
              state: "output-error",
              toolCallId: "call_3",
              input: {},
              errorText: AUTHORING_INTERRUPTED_TOOL_ERROR,
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "ready",
    }),
    "interrupted",
  );

  assert.equal(
    getAuthoringTerminalNotice({
      messages: [
        ...userOnly,
        {
          id: "a4",
          role: "assistant",
          parts: [
            {
              type: "tool-upsertView",
              state: "output-error",
              toolCallId: "call_4",
              input: {},
              errorText: "view contract invalid",
            },
            {
              type: "tool-upsertView",
              state: "output-available",
              toolCallId: "call_5",
              input: {},
              output: { summary: "Staged view." },
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "ready",
    }),
    "viewDraftUpdated",
  );

  assert.equal(
    getAuthoringTerminalNotice({
      messages: [
        ...userOnly,
        {
          id: "a5",
          role: "assistant",
          parts: [
            {
              type: "tool-upsertQuery",
              state: "output-available",
              toolCallId: "call_6",
              input: {},
              output: { summary: "Staged query." },
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "ready",
    }),
    "queryDraftUpdated",
  );

  assert.equal(
    getAuthoringTerminalNotice({
      messages: [
        ...userOnly,
        {
          id: "a6",
          role: "assistant",
          parts: [
            {
              type: "tool-upsertBinding",
              state: "output-available",
              toolCallId: "call_7",
              input: {},
              output: { summary: "Staged binding." },
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "ready",
    }),
    "bindingDraftUpdated",
  );

  assert.equal(
    getAuthoringTerminalNotice({
      messages: [
        ...userOnly,
        {
          id: "a7",
          role: "assistant",
          parts: [
            {
              type: "tool-loadSkillReference",
              state: "output-available",
              toolCallId: "call_8",
              input: {},
              output: { summary: "Loaded." },
            },
          ],
        },
      ] as AuthoringMessage[],
      agentStatus: "ready",
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

  assert.equal(decision.profile, "author-dashboard");
  assert.equal(decision.allowedTools.includes("upsertView"), true);
  assert.equal(decision.allowedTools.includes("upsertQuery"), true);
  assert.equal(decision.allowedTools.includes("deleteView"), true);
  assert.equal(decision.allowedTools.includes("deleteQuery"), true);
  assert.equal(decision.allowedTools.includes("deleteBinding"), true);
  assert.equal(decision.allowedTools.includes("getDraftStatus"), true);
  assert.equal("toolChoice" in decision, false);
});

test("natural-language text does not route or hide authoring tools", () => {
  for (const latestUserText of ["继续", "好的", "删除这个图", "应用", "取消", "帮我增加区域 GMV 对比"]) {
    const decision = computeAuthoringScope(scopeInput({ latestUserText }));

    assert.equal(decision.profile, "author-dashboard", latestUserText);
    assert.equal("toolChoice" in decision, false, latestUserText);
    assert.equal(decision.allowedTools.includes("upsertView"), true, latestUserText);
    assert.equal(decision.allowedTools.includes("deleteView"), true, latestUserText);
    assert.equal(decision.allowedTools.includes("deleteQuery"), true, latestUserText);
    assert.equal(decision.allowedTools.includes("deleteBinding"), true, latestUserText);
  }

  assert.equal(resolveAuthoringIntent("应用"), "author");
  assert.equal(resolveAuthoringIntent("取消"), "author");
  assert.equal(resolveAuthoringIntent("看看有哪些数据"), "author");
  assert.equal(resolveAuthoringIntent("whatever", "explore"), "explore");

  for (const intentSignal of ["apply", "cancel", "ask-capability"] as const) {
    const decision = computeAuthoringScope(
      scopeInput({
        latestUserText: "whatever",
        intentSignal,
      }),
    );
    assert.equal(decision.profile, "chat", intentSignal);
    assert.equal("toolChoice" in decision, false, intentSignal);
    assert.deepEqual(decision.allowedTools, [], intentSignal);
  }
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

  assert.equal(decision.profile, "author-dashboard");
  assert.equal(decision.allowedTools.includes("upsertView"), true);
});

test("selected card constrains authoring scope and blocks dashboard-level requests", () => {
  const dashboardWithView = {
    ...dashboardBase,
    views: [
      {
        id: "v_orders",
        title: "Orders",
        renderer_kind: "echarts" as const,
        check_status: "ok" as const,
      },
    ],
  };

  const cardEdit = computeAuthoringScope(
    scopeInput({
      dashboard: dashboardWithView,
      focusedViewId: "v_orders",
      latestUserText: "把标题改成订单趋势",
    }),
  );

  assert.equal(cardEdit.profile, "author-focused");
  assert.deepEqual(cardEdit.scope, { kind: "focused", viewId: "v_orders" });
  assert.equal(cardEdit.scopeResolution.effective_scope, "focused");
  assert.equal(cardEdit.scopeResolution.selected_view_id, "v_orders");
  assert.equal(cardEdit.scopeResolution.requires_scope_clarification, false);
  assert.equal(cardEdit.allowedTools.includes("upsertView"), true);
  assert.equal(cardEdit.allowedTools.includes("deleteView"), false);

  const dashboardEditWhileFocused = computeAuthoringScope(
    scopeInput({
      dashboard: dashboardWithView,
      focusedViewId: "v_orders",
      latestUserText: "新增一张订单趋势卡片",
    }),
  );

  assert.equal(dashboardEditWhileFocused.profile, "chat");
  assert.deepEqual(dashboardEditWhileFocused.scope, {
    kind: "focused",
    viewId: "v_orders",
  });
  assert.equal(
    dashboardEditWhileFocused.scopeResolution.scope_reason,
    "blocked_dashboard_request",
  );
  assert.equal(
    dashboardEditWhileFocused.scopeResolution.requires_scope_clarification,
    true,
  );
  assert.deepEqual(dashboardEditWhileFocused.allowedTools, []);
  assert.equal("toolChoice" in dashboardEditWhileFocused, false);
});

test("empty or invalid selected card does not implicitly focus the first card", () => {
  const dashboardWithView = {
    ...dashboardBase,
    views: [
      {
        id: "v_orders",
        title: "Orders",
        renderer_kind: "echarts" as const,
        check_status: "ok" as const,
      },
    ],
  };

  const noSelection = computeAuthoringScope(
    scopeInput({
      dashboard: dashboardWithView,
      focusedViewId: null,
      latestUserText: "新增一张订单趋势卡片",
    }),
  );

  assert.equal(noSelection.profile, "author-dashboard");
  assert.deepEqual(noSelection.scope, { kind: "dashboard" });
  assert.equal(noSelection.scopeResolution.effective_scope, "dashboard");
  assert.equal(noSelection.scopeResolution.selected_view_id, null);

  const invalidSelection = computeAuthoringScope(
    scopeInput({
      dashboard: dashboardWithView,
      focusedViewId: "missing_view",
      latestUserText: "新增一张订单趋势卡片",
    }),
  );

  assert.equal(invalidSelection.profile, "author-dashboard");
  assert.deepEqual(invalidSelection.scope, { kind: "dashboard" });
  assert.equal(invalidSelection.scopeResolution.effective_scope, "dashboard");
  assert.equal(invalidSelection.scopeResolution.scope_reason, "invalid_selection");
});

test("authoring context envelope records effective scope and selected card", () => {
  const document: DashboardDocument = {
    ...baseDocument(),
    dashboard_spec: {
      ...baseDocument().dashboard_spec,
      views: [
        {
          id: "v_orders",
          title: "Orders",
          renderer: lineViewSpec().renderer,
        },
      ],
      layout: {
        desktop: {
          cols: 12,
          row_height: 80,
          items: [{ i: "v_orders", view_id: "v_orders", x: 0, y: 0, w: 8, h: 6 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ i: "v_orders", view_id: "v_orders", x: 0, y: 0, w: 4, h: 6 }],
        },
      },
    },
  };
  const draftStatus = {
    summary: "No staged draft.",
    document_hash: "doc_orders",
    data_mode: "undecided" as const,
    has_draft: false,
    has_query: false,
    has_view: false,
    dirty_view_ids: [],
    dirty_query_ids: [],
    dirty_binding_ids: [],
    layout_coverage: [],
    unplaced_view_ids: [],
    last_check_hash: null,
    check_fresh: false,
    live_binding_count: 0,
    mock_binding_count: 0,
    missing_required_bindings: [],
    can_compose: false,
    blockers: ["staging_not_started" as const],
    unresolved_failure: null,
  };
  const workflowStateV2 = {
    activeGoal: {
      id: "goal_orders",
      kind: "create_view" as const,
      status: "active" as const,
      summary: "Orders trend",
      dataMode: "live" as const,
      chartPlan: { chartType: "line" as const },
      targetRefs: { datasourceId: "testing-db", table: "orders" },
      blockers: [],
      createdFromTurnId: "turn_orders",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    },
  };

  const dashboardContext = buildAuthoringContextBlock({
    variant: "dashboard",
    dashboard: document,
    draftStatus,
    workflowStateV2,
    scopeResolution: {
      effective_scope: "dashboard",
      selected_view_id: null,
      scope_reason: "no_selection",
      requires_scope_clarification: false,
    },
  });
  const focusedContext = buildAuthoringContextBlock({
    variant: "focused",
    dashboard: document,
    focusedViewId: "v_orders",
    draftStatus,
    workflowStateV2,
    scopeResolution: {
      effective_scope: "focused",
      selected_view_id: "v_orders",
      scope_reason: "selected_view",
      requires_scope_clarification: false,
    },
  });

  const dashboardEnvelope = extractContextEnvelope(dashboardContext.markdown);
  const focusedEnvelope = extractContextEnvelope(focusedContext.markdown);

  assert.equal(
    dashboardEnvelope.scope_resolution.effective_scope,
    "dashboard",
  );
  assert.equal(dashboardEnvelope.scope_resolution.selected_view_id, null);
  assert.equal(dashboardEnvelope.workflow_v2?.active_goal?.id, "goal_orders");
  assert.equal(dashboardEnvelope.workflow_v2?.active_goal?.chart_type, "line");
  assert.equal("lifecycle" in dashboardEnvelope, false);
  assert.equal("action" in (dashboardEnvelope.workflow_v2 ?? {}), false);
  const workflowJson = JSON.stringify(dashboardEnvelope.workflow_v2);
  assert.doesNotMatch(workflowJson, /"tool":/);
  assert.doesNotMatch(workflowJson, /"reason":/);
  assert.doesNotMatch(workflowJson, /"blocker":/);
  assert.doesNotMatch(workflowJson, /"reference_kind":/);
  assert.equal(focusedEnvelope.scope_resolution.effective_scope, "focused");
  assert.equal(focusedEnvelope.scope_resolution.selected_view_id, "v_orders");
  assert.notEqual(dashboardContext.fingerprint, focusedContext.fingerprint);
});

test("workflow inspection tolerates legacy authoring scope data parts", () => {
  const workflow = findLatestWorkflow([
    {
      id: "assistant_legacy_scope",
      role: "assistant",
      parts: [
        {
          type: "data-authoring_scope",
          data: {
            mode: "author-dashboard",
            scope: { kind: "dashboard" },
            activeTools: ["getDraftStatus", "upsertView"],
            relevantSkillIds: ["echarts-skills"],
            stopReason: null,
          },
        },
      ],
    },
  ] as unknown as AuthoringMessage[]);

  assert.equal(workflow?.mode, "author-dashboard");
  assert.deepEqual(workflow?.active_tools, ["getDraftStatus", "upsertView"]);
  assert.deepEqual(workflow?.skill_ids, ["echarts-skills"]);
});

test("native tool approval state no longer exposes applyPatch", () => {
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

  assert.equal(decision.profile, "chat");
  assert.deepEqual(decision.allowedTools, []);
  assert.equal("toolChoice" in decision, false);
});

test("local compose output waits for UI approval instead of exposing applyPatch", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "继续",
      conversation: {
        latestUserText: "继续",
        approvalState: "none",
        latestDraftOutput: {
          suggestion: {
            id: "patch_gmv",
            kind: "data",
            title: "GMV Trend",
            summary: "Prepared GMV trend.",
            patch: { summary: "Add GMV trend.", operations: [] },
            dashboard: baseDocument(),
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
    }),
  );

  assert.equal(decision.profile, "chat");
  assert.deepEqual(decision.allowedTools, []);
  assert.equal("toolChoice" in decision, false);

  const afterLocalResolution = computeAuthoringScope(
    scopeInput({
      latestUserText: "帮我增加区域 GMV 对比",
      conversation: {
        latestUserText: "帮我增加区域 GMV 对比",
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
    }),
  );

  assert.equal(afterLocalResolution.profile, "author-dashboard");
  assert.equal(afterLocalResolution.allowedTools.includes("upsertView"), true);
  assert.equal(afterLocalResolution.allowedTools.includes("getDraftStatus"), true);
});

test("confirmed data followup keeps authoring tools available without view-structure blocker", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "可以的",
    }),
  );

  assert.equal(decision.profile, "author-dashboard");
  assert.equal(decision.allowedTools.includes("upsertView"), true);
  assert.equal(decision.allowedTools.includes("composePatch"), false);
});

test("ready data context plus affirmative followup keeps write tools available", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "可以",
    }),
  );

  assert.equal(decision.profile, "author-dashboard");
  assert.equal(decision.allowedTools.includes("upsertView"), true);
  assert.equal(decision.allowedTools.includes("upsertQuery"), true);
});

test("explicit build report request gets the same authoring tool surface", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "先搭建 GMV 报表",
    }),
  );

  assert.equal(decision.profile, "author-dashboard");
  assert.equal(decision.allowedTools.includes("upsertView"), true);
  assert.equal(decision.allowedTools.includes("upsertQuery"), true);
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

  assert.equal(decision.profile, "author-dashboard");
  assert.equal(decision.allowedTools.includes("upsertView"), false);
  assert.equal(decision.allowedTools.includes("upsertQuery"), true);
  assert.equal(decision.allowedTools.includes("upsertBinding"), true);
});

test("skill catalog is not filtered by user text", () => {
  const decision = computeAuthoringScope(
    scopeInput({
      latestUserText: "做一个趋势图",
    }),
  );
  assert.deepEqual(decision.relevantSkillIds, []);
});

test("loaded skill references expose machine-readable checks", async () => {
  const timeSeries = await loadAuthoringSkillReference(
    "data-format-skills",
    "time-series",
  );
  assert.ok(timeSeries?.check);
  assert.equal(timeSeries.check.reference_key, "data-format-skills/time-series");
});

test("tool runtime gates skill checks from loaded references", async () => {
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: {
      ...createValidationOnlyAuthoringDependencies(),
      loadSkillReference: async (skillId, referenceName) =>
        loadAuthoringSkillReference(skillId, referenceName),
    },
  });
  await executeTool(runtime.tools.loadSkillReference, {
    skill_id: "data-format-skills",
    reference_name: "time-series",
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

test("upsertLayout stages layout independently and records goal ownership", async () => {
  const document: DashboardDocument = {
    ...baseDocument(),
    dashboard_spec: {
      ...baseDocument().dashboard_spec,
      views: [
        {
          id: "v_gmv_trend",
          title: "GMV Trend",
          renderer: lineViewSpec().renderer,
        },
      ],
    },
  };
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: document,
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
    getActiveGoalId: () => "goal_1",
  });

  const result = await executeTool(runtime.tools.upsertLayout, {
    view_id: "v_gmv_trend",
    layout: {
      desktop: { x: 0, y: 0, w: 6, h: 4 },
      mobile: { x: 0, y: 0, w: 4, h: 5 },
    },
  });

  assert.equal((result as { view_id: string }).view_id, "v_gmv_trend");
  const snapshot = runtime.getDraftSnapshot();
  assert.equal(snapshot?.layoutTouched, true);
  assert.equal(
    snapshot?.ownership?.currentByGoal.goal_1?.layoutId,
    "v_gmv_trend",
  );
  const candidate = runtime.getCandidateDocumentSnapshot();
  assert.deepEqual(candidate.dashboard_spec.layout.desktop?.items, [
    { view_id: "v_gmv_trend", x: 0, y: 0, w: 6, h: 4 },
  ]);
  assert.deepEqual(candidate.dashboard_spec.layout.mobile?.items, [
    { view_id: "v_gmv_trend", x: 0, y: 0, w: 4, h: 5 },
  ]);
  assert.equal(candidate.dashboard_spec.views[0]?.title, "GMV Trend");
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

  assert.equal(replay.decisions[0]?.profile, "explore");
  assert.equal(replay.decisions[0]?.allowedTools.includes("upsertView"), false);
  assert.equal(replay.decisions[1]?.profile, "author-dashboard");
  assert.equal(replay.decisions[1]?.allowedTools.includes("upsertView"), true);
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
  assert.equal(replay.decisions.at(-1)?.allowedTools.includes("upsertView"), true);
});

test("action-specific prompt omits legacy task state recovery state", () => {
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "repair_artifact", "dashboard"],
    scope: { kind: "dashboard" },
    skills,
  });
  assert.match(prompt, /Current action: repair the failed draft artifact once/i);
  assert.doesNotMatch(prompt, /Current task state/i);
  assert.doesNotMatch(prompt, /last failed authoring tool/i);
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
          items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
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

  const mockDraft = {
    ...partialDraft,
    queryDefs: [],
    dirtyQueryIds: [],
    bindings: [
      {
        id: "b_gmv_x_mock",
        view_id: "v_gmv_trend",
        slot_id: "x",
        mode: "mock" as const,
        mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
      },
      {
        id: "b_gmv_y_mock",
        view_id: "v_gmv_trend",
        slot_id: "y",
        mode: "mock" as const,
        mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
      },
    ],
    bindingMode: "mock" as const,
    dirtyBindingIds: ["b_gmv_x_mock", "b_gmv_y_mock"],
  };
  assert.equal(
    isDraftReadyForCompose({
      dashboard: baseDocument(),
      draft: mockDraft,
    }),
    true,
  );
  assert.equal(
    isDraftReadyForCompose({
      dashboard: baseDocument(),
      draft: {
        ...mockDraft,
        queryDefs: [timeSeriesQuery()],
        dirtyQueryIds: ["q_gmv_trend"],
        bindingMode: "live" as const,
      },
    }),
    false,
  );
});

test("getDraftStatus reports missing bindings and compose readiness", () => {
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
          items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
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
  const candidate = {
    dashboard_spec: partialDraft.dashboardSpec!,
    query_defs: partialDraft.queryDefs!,
    bindings: [],
  };

  const missing = buildDraftStatus({
    dashboard: baseDocument(),
    candidate,
    draft: partialDraft,
    documentHash: buildDocumentFingerprint(candidate),
    lastRunCheckState: null,
  });
  assert.equal(missing.can_compose, false);
  assert.equal(missing.data_mode, "live");
  assert.deepEqual(missing.blockers, ["missing_required_bindings"]);
  assert.equal(missing.missing_required_bindings.length, 2);
  assert.equal(missing.missing_required_bindings[0]?.view_id, "v_gmv_trend");
  assert.equal(missing.missing_required_bindings[0]?.slot_id, "x");
  assert.equal(missing.missing_required_bindings[0]?.expected_mode, "live");

  const mockOnly = buildDraftStatus({
    dashboard: baseDocument(),
    candidate: {
      ...candidate,
      bindings: [
        {
          id: "b_v_gmv_trend_x_mock",
          view_id: "v_gmv_trend",
          slot_id: "x",
          mode: "mock",
          mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
        },
      ],
    },
    documentHash: buildDocumentFingerprint({
      ...candidate,
      bindings: [
        {
          id: "b_v_gmv_trend_x_mock",
          view_id: "v_gmv_trend",
          slot_id: "x",
          mode: "mock",
          mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
        },
      ],
    }),
    lastRunCheckState: null,
    draft: {
      ...partialDraft,
      bindings: [
        {
          id: "b_v_gmv_trend_x_mock",
          view_id: "v_gmv_trend",
          slot_id: "x",
          mode: "mock",
          mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
        },
      ],
      bindingMode: "mock",
      dirtyBindingIds: ["b_v_gmv_trend_x_mock"],
    },
  });
  assert.equal(mockOnly.can_compose, false);
  assert.equal(mockOnly.mock_binding_count, 1);
  assert.equal(mockOnly.data_mode, "mock");
  assert.equal(mockOnly.missing_required_bindings.length, 1);
  assert.equal(mockOnly.missing_required_bindings[0]?.slot_id, "y");
  assert.equal(mockOnly.missing_required_bindings[0]?.expected_mode, "mock");

  const mockBoundDraft = {
    ...partialDraft,
    queryDefs: [],
    dirtyQueryIds: [],
    bindings: [
      {
        id: "b_gmv_x_mock",
        view_id: "v_gmv_trend",
        slot_id: "x",
        mode: "mock" as const,
        mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
      },
      {
        id: "b_gmv_y_mock",
        view_id: "v_gmv_trend",
        slot_id: "y",
        mode: "mock" as const,
        mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
      },
    ],
    bindingMode: "mock" as const,
    dirtyBindingIds: ["b_gmv_x_mock", "b_gmv_y_mock"],
  };
  const mockBoundCandidate = {
    dashboard_spec: mockBoundDraft.dashboardSpec!,
    query_defs: [],
    bindings: mockBoundDraft.bindings,
  };
  const mockBoundHash = buildDocumentFingerprint(mockBoundCandidate);
  const mockComplete = buildDraftStatus({
    dashboard: baseDocument(),
    candidate: mockBoundCandidate,
    draft: mockBoundDraft,
    documentHash: mockBoundHash,
    lastRunCheckState: {
      fingerprint: mockBoundHash,
      signatures: [],
      consecutiveRepeatCount: 0,
    },
  });
  assert.equal(mockComplete.data_mode, "mock");
  assert.equal(mockComplete.has_query, false);
  assert.equal(mockComplete.can_compose, true);
  assert.equal(mockComplete.missing_required_bindings.length, 0);

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
    bindingMode: "live" as const,
    dirtyBindingIds: ["b_gmv_x", "b_gmv_y"],
  };
  const completeCandidate = {
    ...candidate,
    bindings: boundDraft.bindings,
  };
  const completeHash = buildDocumentFingerprint(completeCandidate);
  const complete = buildDraftStatus({
    dashboard: baseDocument(),
    candidate: completeCandidate,
    draft: boundDraft,
    documentHash: completeHash,
    lastRunCheckState: {
      fingerprint: completeHash,
      signatures: [],
      consecutiveRepeatCount: 0,
    },
  });
  assert.equal(complete.can_compose, true);
  assert.equal(complete.missing_required_bindings.length, 0);

  const blocked = buildDraftStatus({
    dashboard: baseDocument(),
    candidate: completeCandidate,
    draft: boundDraft,
    documentHash: completeHash,
    lastRunCheckState: {
      fingerprint: completeHash,
      signatures: [],
      consecutiveRepeatCount: 0,
    },
    activeGoal: {
      id: "goal_failed",
      kind: "create_view",
      status: "active",
      summary: "GMV 周度趋势",
      dataMode: "live",
      targetRefs: {},
      blockers: [],
      repairState: {
        runCheckAttempts: 1,
        target: "view",
        lastFailure: {
          toolName: "upsertView",
          code: "view_failed",
          message: "view failed",
          occurredAt: "2026-04-27T00:00:00.000Z",
        },
      },
      createdFromTurnId: "turn",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    },
  });
  assert.equal(blocked.can_compose, false);
  assert.ok(blocked.blockers.includes("unresolved_tool_failure"));
  assert.equal(blocked.unresolved_failure?.tool_name, "upsertView");
});

test("draft status exposes facts without workflow next-action control", () => {
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
          items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
        },
        mobile: {
          cols: 4,
          row_height: 80,
          items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
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
  const completeDraft = {
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
    bindingMode: "live" as const,
    dirtyBindingIds: ["b_gmv_x", "b_gmv_y"],
  };

  const candidate = {
    ...baseDocument(),
    dashboard_spec: partialDraft.dashboardSpec!,
    query_defs: partialDraft.queryDefs!,
    bindings: partialDraft.bindings ?? [],
  };
  const status = buildDraftStatus({
    dashboard: baseDocument(),
    candidate,
    draft: partialDraft,
    documentHash: buildDocumentFingerprint(candidate),
    lastRunCheckState: null,
  });
  const prompt = buildAuthoringSystemPrompt({
    sections: ["identity", "authoring", "dashboard"],
    scope: { kind: "dashboard" },
    skills,
    draftStatus: status,
  });
  assert.match(prompt, /Current draft status/);
  assert.match(prompt, /missing_required_bindings/);
  assert.match(prompt, /authoritative facts/);
  assert.doesNotMatch(prompt, new RegExp("next" + "_required_action"));

  const completeCandidate = {
    ...candidate,
    bindings: completeDraft.bindings,
  };
  const completeHash = buildDocumentFingerprint(completeCandidate);
  const completeStatus = buildDraftStatus({
    dashboard: baseDocument(),
    candidate: completeCandidate,
    draft: completeDraft,
    documentHash: completeHash,
    lastRunCheckState: {
      fingerprint: completeHash,
      signatures: [],
      consecutiveRepeatCount: 0,
    },
  });
  assert.equal(completeStatus.can_compose, true);
  assert.match(
    buildAuthoringSystemPrompt({
      sections: ["identity", "authoring", "dashboard"],
      scope: { kind: "dashboard" },
      skills,
      draftStatus: completeStatus,
    }),
    /"can_compose":true/,
  );

  const failedStatus = buildDraftStatus({
    dashboard: baseDocument(),
    candidate,
    draft: partialDraft,
    documentHash: buildDocumentFingerprint(candidate),
    lastRunCheckState: null,
    activeGoal: {
      id: "goal_failed",
      kind: "create_view",
      status: "active",
      summary: "GMV Trend",
      dataMode: "live",
      targetRefs: {},
      blockers: [],
      repairState: {
        runCheckAttempts: 1,
        target: "view",
        lastFailure: {
          toolName: "upsertView",
          code: "renderer_missing",
          message: "renderer missing",
          occurredAt: "2026-04-27T00:00:00.000Z",
        },
      },
      createdFromTurnId: "turn",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    },
  });
  assert.equal(failedStatus.blockers.includes("unresolved_tool_failure"), true);
  assert.equal(failedStatus.unresolved_failure?.tool_name, "upsertView");
});

test("agent workflow no longer imports legacy lifecycle decision", async () => {
  const source = await readFile(
    new URL("../src/ai/authoring/agent.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, new RegExp("derive" + "AuthoringLifecycleDecision"));
  assert.match(source, /decideNextActionV2/);
  assert.match(source, /prepareToolStepV2/);
  assert.match(source, /enforceWorkflowToolCapability/);
  assert.doesNotMatch(source, /prepareForcedToolStepV2/);
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
        items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
      },
      mobile: {
        cols: 4,
        row_height: 80,
        items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
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
    getLastRunCheckState: () => null,
    setLatestProposalMeta: () => {},
    buildCandidateDocument,
    buildDocumentFingerprint,
  });

  await assert.rejects(
    () => executeTool(composePatch, {}),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "binding_mismatch");
      assert.match(error.recoveryHint, /Required .*slots are not bound/i);
      return true;
    },
  );
});

test("composePatch accepts fully bound mock placeholder views", async () => {
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
        items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
      },
      mobile: {
        cols: 4,
        row_height: 80,
        items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
      },
    },
  };
  workingDraft.bindings = [
    {
      id: "b_gmv_x_mock",
      view_id: "v_gmv_trend",
      slot_id: "x",
      mode: "mock",
      mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
    },
    {
      id: "b_gmv_y_mock",
      view_id: "v_gmv_trend",
      slot_id: "y",
      mode: "mock",
      mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
    },
  ];
  workingDraft.bindingMode = "mock";
  workingDraft.dirtyViewIds.add("v_gmv_trend");
  workingDraft.dirtyBindingIds.add("b_gmv_x_mock");
  workingDraft.dirtyBindingIds.add("b_gmv_y_mock");
  workingDraft.layoutTouched = true;

  const candidate = buildCandidateDocument(document, workingDraft);
  const fingerprint = buildDocumentFingerprint(candidate);
  const composePatch = buildComposePatchTool({
    dashboard: document,
    dependencies: {
      ...createValidationOnlyAuthoringDependencies(),
      executePreview: async () => ({
        httpStatus: 200,
        body: {
          status_code: 200,
          reason: "OK",
          data: {
            binding_results: {},
            renderer_checks: {},
          },
        },
      }),
    },
    workingDraft,
    getLastRunCheckState: () => ({
      fingerprint,
      signatures: [],
      consecutive_repeat_count: 0,
    }),
    setLatestProposalMeta: () => {},
    buildCandidateDocument,
    buildDocumentFingerprint,
  });

  const output = await executeTool(composePatch, {});
  assert.match(JSON.stringify(output), /Mock placeholder/);
  assert.match(JSON.stringify(output), /mock placeholder bindings/i);
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
        items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 8, h: 6 }],
      },
      mobile: {
        cols: 4,
        row_height: 80,
        items: [{ i: "v_gmv_trend", view_id: "v_gmv_trend", x: 0, y: 0, w: 4, h: 6 }],
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
      assert.match(error.recoveryHint, /Required view slots are not bound/i);
      return true;
    },
  );
});

test("applyPatch approval gate honors runtime-approved approval events", async () => {
  const workingDraft = createWorkingDraftState(null);
  const runtimeApprovedPatch = buildApplyPatchTool({
    dashboard: baseDocument(),
    dependencies: createValidationOnlyAuthoringDependencies(),
    messages: [],
    workingDraft,
    resetWorkingDraft: () => {},
    recordMutation: () => {},
    getLatestProposalMeta: () => null,
    hasRuntimeApproval: () => true,
    buildCandidateDocument,
  });
  const normalPatch = buildApplyPatchTool({
    dashboard: baseDocument(),
    dependencies: createValidationOnlyAuthoringDependencies(),
    messages: [],
    workingDraft,
    resetWorkingDraft: () => {},
    recordMutation: () => {},
    getLatestProposalMeta: () => null,
    hasRuntimeApproval: () => false,
    buildCandidateDocument,
  });

  const runtimeNeedsApproval = (runtimeApprovedPatch as {
    needsApproval?: (
      input: unknown,
      context: { messages: unknown[] },
    ) => Promise<boolean>;
  }).needsApproval;
  const normalNeedsApproval = (normalPatch as {
    needsApproval?: (
      input: unknown,
      context: { messages: unknown[] },
    ) => Promise<boolean>;
  }).needsApproval;

  assert.equal(typeof runtimeNeedsApproval, "function");
  assert.equal(typeof normalNeedsApproval, "function");
  assert.equal(
    await runtimeNeedsApproval?.({}, { messages: [] }),
    false,
  );
  assert.equal(
    await normalNeedsApproval?.({}, { messages: [] }),
    true,
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
  assert.equal(harness.candidate().bindings.length, 0);
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

test("write tools can create explicit mock bindings without a query", async () => {
  const lineCheck = await loadRequiredCheck("echarts-skills", "line-timeseries");
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  const harness = makeToolHarness([lineCheck, timeCheck]);

  await executeTool(harness.upsertView, {
    request: "Create weekly GMV trend with mock placeholders",
    skill_reference: lineCheck.reference_key,
    view_spec: lineViewSpec(),
  });
  await executeTool(harness.upsertBinding, {
    binding: {
      id: "b_gmv_x_mock",
      view_id: "v_gmv_trend",
      slot_id: "x",
      mode: "mock",
      mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
    },
  });
  await executeTool(harness.upsertBinding, {
    binding: {
      id: "b_gmv_y_mock",
      view_id: "v_gmv_trend",
      slot_id: "y",
      mode: "mock",
      mock_data: { rows: [{ bucket_date: "2026-01-01", metric_value: 1 }] },
    },
  });

  const candidate = harness.candidate();
  assert.equal(candidate.dashboard_spec.views.length, 1);
  assert.equal(candidate.query_defs.length, 0);
  assert.equal(candidate.bindings.length, 2);
  assert.equal(harness.workingDraft.bindingMode, "mock");
});

test("upsertView prunes stale unbound retry views from an empty data draft", async () => {
  const lineCheck = await loadRequiredCheck("echarts-skills", "line-timeseries");
  const timeCheck = await loadRequiredCheck("data-format-skills", "time-series");
  const harness = makeToolHarness([lineCheck, timeCheck]);

  harness.workingDraft.queryDefs = [timeSeriesQuery()];
  harness.workingDraft.dirtyQueryIds.add("q_gmv_trend");
  harness.workingDraft.dashboardSpec = {
    ...baseDocument().dashboard_spec,
    views: [
      {
        id: "v_ai_1",
        title: "Stale Shell",
        renderer: lineViewSpec().renderer,
      },
    ],
    layout: {
      desktop: {
        cols: 12,
        row_height: 80,
        items: [{ view_id: "v_ai_1", x: 0, y: 0, w: 8, h: 6 }],
      },
      mobile: {
        cols: 4,
        row_height: 80,
        items: [{ view_id: "v_ai_1", x: 0, y: 0, w: 4, h: 6 }],
      },
    },
  };
  harness.workingDraft.dirtyViewIds.add("v_ai_1");
  harness.workingDraft.layoutTouched = true;

  await executeTool(harness.upsertView, {
    request: "Create weekly GMV trend",
    skill_reference: lineCheck.reference_key,
    view_spec: {
      ...lineViewSpec(),
      view_id: "v_gmv_weekly_trend",
      title: "GMV Weekly Trend",
    },
  });

  const candidate = harness.candidate();
  assert.deepEqual(
    candidate.dashboard_spec.views.map((view) => view.id),
    ["v_gmv_weekly_trend"],
  );
  assert.deepEqual(
    candidate.dashboard_spec.layout.desktop?.items.map((item) => item.view_id),
    ["v_gmv_weekly_trend"],
  );
  assert.equal(harness.workingDraft.dirtyViewIds.has("v_ai_1"), false);
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

test("legacy task-state runtime module is removed", async () => {
  const agentSource = await readFile(
    new URL("../src/ai/authoring/agent.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(agentSource, /runtime-facts/);
  assert.doesNotMatch(agentSource, /AuthoringTaskStateSnapshot/);
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
  });

  assert.match(prompt, /Tool input contracts live in tool descriptions and schemas/i);
  assert.match(prompt, /Workflow runtime resolves intent/i);
  assert.match(prompt, /currently available tool surface/i);
  assert.match(prompt, /Do not decide workflow sequencing/i);
  assert.match(prompt, /Do not treat advisory or exploration questions as creation requests/i);
  assert.match(prompt, /Advisory-only questions/i);
  assert.match(prompt, /only stage an internal working draft/i);
  assert.doesNotMatch(prompt, /Current task state:/);
  assert.doesNotMatch(prompt, /last failed authoring tool/i);
  assert.doesNotMatch(prompt, /Canonical QueryDef is strict/i);
  assert.doesNotMatch(prompt, /canonical View shape/i);
  assert.doesNotMatch(prompt, /canonical Binding shape/i);
  assert.doesNotMatch(prompt, /The code does not infer natural-language intent/i);
  assert.doesNotMatch(prompt, /You decide whether to inspect data/i);
  assert.doesNotMatch(prompt, /continue in the same turn/i);
  assert.doesNotMatch(prompt, /in the same turn, call getSchemaByDatasource/i);
  assert.doesNotMatch(prompt, /call upsertBinding/i);
  assert.doesNotMatch(prompt, /call upsertBinding next/i);
  assert.doesNotMatch(prompt, /After composePatch succeeds, stop/i);
  assert.doesNotMatch(prompt, /Do not end the turn after only/i);
  assert.doesNotMatch(prompt, /Do not call tools/i);
  assert.doesNotMatch(prompt, /wait for approval/i);
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

  assert.match(skillTool.description ?? "", /runtime-selected step/i);
  assert.match(referenceTool.description ?? "", /runtime-selected step/i);
  assert.match(referenceTool.description ?? "", /renderer, data-shape, layout/i);
  assert.doesNotMatch(skillTool.description ?? "", /continue with/i);
  assert.doesNotMatch(skillTool.description ?? "", /not a final action/i);
  assert.doesNotMatch(referenceTool.description ?? "", /upsertQuery\/upsertView\/upsertBinding/i);
  assert.doesNotMatch(referenceTool.description ?? "", /same turn/i);
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
    assert.doesNotMatch(contract, /Continue with/i);
    assert.doesNotMatch(contract, /call composePatch/i);
    assert.doesNotMatch(contract, /then stop/i);
  }

  assert.match(
    UPSERT_QUERY_TOOL_CONTRACT,
    /Do not stage exploratory queries just to answer what analysis is possible/i,
  );
  assert.match(UPSERT_BINDING_TOOL_CONTRACT, /cover the requested renderer slots/i);
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
