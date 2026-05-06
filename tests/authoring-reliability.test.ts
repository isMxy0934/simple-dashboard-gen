import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import type { AuthoringScopeInput } from "../src/ai/authoring/runtime/capability-scope.ts";
import type {
  AuthoringChatSessionPayload,
} from "../src/ai/authoring/contracts/session.ts";
import type { AuthoringUiMessage } from "../src/web/authoring/agent/types.ts";
import type { MutationDescriptor } from "../src/ai/authoring/contracts/mutations.ts";
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
const { isAuthoringChatSessionPayload, sanitizeAuthoringChatSessionPayload } = await import(
  "../src/ai/authoring/runtime/session-sanitize.ts"
);
const { isAgentChatRequestBody } = await import(
  "../src/server/authoring/chat-request-schema.ts"
);
const { listAuthoringSkills, loadAuthoringSkill } = await import(
  "../src/server/ai/skill-loader.ts"
);
const {
  buildApplyPatchTool,
  buildComposePatchTool,
  buildUpsertBindingTool,
  buildUpsertQueryTool,
  buildUpsertViewTool,
} = await import("../src/ai/authoring/tools/write-tools.ts");
const { assertFocusedPatchBoundary } = await import(
  "../src/ai/authoring/tools/focused-guards.ts"
);
const { buildDraftStatus } = await import(
  "../src/ai/authoring/tools/draft-status.ts"
);
const { buildLoadSkillTool } = await import("../src/ai/authoring/tools/shared-tools.ts");
const { buildAuthoringTools } = await import("../src/ai/authoring/tools/factory.ts");
const {
  buildInspectToolSurface,
  buildWorkflowToolSurface,
  selectAuthoringToolSet,
} = await import("../src/ai/authoring/agent/tool-surface.ts");
const {
  AUTHORING_TOOL_REGISTRY,
  getInspectLaneToolNames,
} = await import("../src/ai/authoring/tools/registry.ts");
const {
  createWorkingDraftState,
  markWorkingDraftArtifactOwner,
} = await import(
  "../src/ai/authoring/tools/draft-state.ts"
);
const { createValidationOnlyAuthoringDependencies } = await import(
  "../src/ai/authoring/runtime/dependencies.ts"
);
const {
  buildCandidateDocument,
  buildDocumentFingerprint,
} = await import("../src/ai/authoring/tools/candidate-document.ts");
const { z } = await import("zod");
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
  "../src/web/authoring/agent/incomplete-tools.ts"
);
const { convertToLlm } = await import(
  "../src/ai/authoring/runtime/llm-boundary.ts"
);
const { formatAuthoringToolResultText } = await import(
  "../src/ai/authoring/runtime/tool-result-content.ts"
);
const {
  assertProviderPayloadBoundary,
  inspectProviderPayloadBoundary,
} = await import("../src/ai/authoring/agent/provider-payload-guard.ts");
const {
  projectAgentMessagesToUiMessages,
  reduceAgentEventToUiMessages,
} = await import("../src/web/authoring/agent/agent-event-reducer.ts");
const { findLatestDraftOutput, findLatestWorkflow } = await import(
  "../src/web/authoring/agent/inspection.ts"
);
const { pruneResolvedPatchProposalPayloads } = await import(
  "../src/web/authoring/agent/message-prune.ts"
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
    id: "echarts-line",
    name: "echarts-line",
    description: "Create or revise ECharts line and time-series charts.",
    path: "skills/echarts-line/SKILL.md",
    triggers: ["折线图", "趋势", "time series"],
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

function makeToolHarness(
  document: DashboardDocument = baseDocument(),
) {
  const workingDraft = createWorkingDraftState(null);
  const mutations: MutationDescriptor[] = [];
  const common = {
    dashboard: document,
    focusedViewId: null,
    workingDraft,
    assertRepeatFailureWindowOpen: () => {},
    markWorkingDraftUpdated: () => {},
    recordMutation: (mutation) => {
      mutations.push(mutation);
    },
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
    workflow?: {
      active_goal?: {
        id?: string;
        chart_skill_id?: string | null;
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

test("session sanitizer resets legacy payloads and preserves current workflow", () => {
  const legacyPayload = {
    version: 3,
    sessionId: "sess_1",
    dashboardId: "db_1",
    messages: [],
    updatedAt: "2026-04-25T00:00:00.000Z",
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
      workflow: {
        goals: [
          {
            id: "goal_1",
            kind: "create_view",
            status: "awaiting_approval",
            summary: "GMV trend",
            dataMode: "live",
            chartPlan: { chartSkillId: "echarts-line" },
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
        loadedSkillReferences: ["echarts-line"],
        updatedAt: "2026-04-25T00:00:00.000Z",
      },
    },
  } as unknown as AuthoringChatSessionPayload;

  assert.equal(isAuthoringChatSessionPayload(legacyPayload), false);
  const reset = sanitizeAuthoringChatSessionPayload(legacyPayload);
  assert.equal("taskState" in reset.prompt, false);
  assert.equal(reset.version, 5);
  assert.deepEqual(reset.messages, []);
  assert.equal(reset.prompt.workflow, null);

  const currentPayload = {
    version: 5,
    sessionId: "sess_1",
    dashboardId: "db_1",
    messages: [],
    updatedAt: "2026-04-25T00:00:00.000Z",
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
      workflow: {
        goals: [
          {
            id: "goal_1",
            kind: "create_view",
            status: "awaiting_approval",
            summary: "GMV trend",
            dataMode: "live",
            chartPlan: { chartSkillId: "echarts-line" },
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
      },
    },
  } as AuthoringChatSessionPayload;

  assert.equal(isAuthoringChatSessionPayload(currentPayload), true);
  const sanitized = sanitizeAuthoringChatSessionPayload(currentPayload);
  assert.equal(sanitized.version, 5);
  assert.equal(sanitized.prompt.workflow?.pendingProposalBaseVersion, 3);
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
  ] as AuthoringUiMessage[];

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
      approvalEvent: {
        proposalId: "patch_1",
        decision: "approve",
        baseVersion: "5",
      },
    }),
    false,
  );

  assert.equal(
    isAgentChatRequestBody({
      sessionId: "sess_approval",
      dashboard: baseDocument(),
      messages: [],
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

test("session persistence keeps only pi transcript and no UI compatibility fields", async () => {
  const serviceSource = await readFile(
    new URL("../src/server/authoring/chat-service.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(serviceSource, /uiMessages/);
  assert.doesNotMatch(serviceSource, /finalizeIncompleteToolCalls/);
  assert.doesNotMatch(serviceSource, /getRejectedProposalIdSnapshot/);

  const orchestratorSource = await readFile(
    new URL("../src/server/authoring/chat-session-orchestrator.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(orchestratorSource, /uiMessages/);
  assert.doesNotMatch(orchestratorSource, /hasLegacyReject/);
  assert.doesNotMatch(orchestratorSource, /hasRejectedApprovalResponse/);
  assert.doesNotMatch(orchestratorSource, /taskState/);
  assert.match(orchestratorSource, /messages: input\.agentMessages \?\? latest\.messages/);
});

test("accepted final reject pruning removes all composePatch dashboard payloads", () => {
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
    stabilization: {
      status: "not-needed",
      checked: true,
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
  ] as AuthoringUiMessage[];

  assert.equal(findLatestDraftOutput(messages)?.suggestion.id, "patch_current");

  const pruned = pruneResolvedPatchProposalPayloads(messages, {
    mode: "all_unresolved",
  });

  assert.equal(findLatestDraftOutput(pruned), null);
});

test("convertToLlm strips provider runtime metadata and filters UI-only messages", () => {
  const messages = [
    {
      role: "user",
      content: "做 GMV 趋势",
      timestamp: 1,
    },
    {
      role: "authoring",
      kind: "notice",
      content: "UI only",
      timestamp: 2,
    },
    {
      role: "assistant",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 3,
      providerOptions: { openai: { itemId: "msg_stale" } },
      content: [
        {
          type: "text",
          text: "开始搭建。",
          providerMetadata: { openai: { itemId: "msg_stale" } },
        },
        {
          type: "thinking",
          thinking: "Need trend chart.",
          providerOptions: {
            openai: {
              itemId: "rs_stale",
            },
          },
        },
        {
          type: "toolCall",
          id: "call_1",
          name: "upsertQuery",
          arguments: {},
          callProviderMetadata: { openai: { itemId: "fc_stale" } },
        },
      ],
    },
  ] as never[];

  const llmMessages = convertToLlm(messages);
  assert.equal(llmMessages.length, 2);
  const serialized = JSON.stringify(llmMessages);
  assert.doesNotMatch(serialized, /providerOptions|providerMetadata|callProviderMetadata|resultProviderMetadata/);
  assert.doesNotMatch(serialized, /msg_stale|rs_stale|fc_stale|item_reference/);
});

test("tool result formatter keeps business details out of LLM-visible content", () => {
  const candidate = {
    ...baseDocument(),
    query_defs: [timeSeriesQuery()],
    bindings: [
      {
        id: "b_gmv_trend",
        view_id: "v_gmv_trend",
        slot_id: "x",
        query_id: "q_gmv_trend",
      },
    ],
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
  } as never;
  const composeOutput = {
    suggestion: {
      id: "patch_boundary",
      kind: "data",
      title: "GMV Trend Patch",
      summary: "Prepared a GMV trend chart.",
      details: ["Adds query, view, and binding."],
      patch: {
        summary: "Add GMV trend chart.",
        operations: [
          { op: "add", path: "dashboard_spec.views.0", summary: "Add view." },
          { op: "add", path: "query_defs.0", summary: "Add query." },
          { op: "add", path: "bindings.0", summary: "Add binding." },
        ],
      },
      dashboard: candidate,
    },
    approval: {
      required: true,
      status: "pending",
      summary: "Review patch.",
      operation_count: 3,
      affected_paths: [
        "dashboard_spec.views.0",
        "query_defs.0",
        "bindings.0",
      ],
    },
    draft_fingerprint: "fp_boundary",
    base_version: 9,
    runtime_check: {
      status: "ok",
      reason: "Runtime check passed.",
      counts: { ok: 1, empty: 0, error: 0 },
      errors: [],
    },
    stabilization: {
      status: "not-needed",
      checked: true,
      notes: [],
    },
  };

  const composeText = formatAuthoringToolResultText(
    "composePatch",
    composeOutput,
  );
  assert.match(composeText, /proposal_id: patch_boundary/);
  assert.match(composeText, /operation_count: 3/);
  assert.match(composeText, /affected_paths:/);
  assert.doesNotMatch(
    composeText,
    /dashboard_spec|query_defs|bindings|sql_template|option_template/,
  );

  const applyText = formatAuthoringToolResultText("applyPatch", {
    applied: true,
    suggestion_id: "patch_boundary",
    kind: "data",
    title: "GMV Trend Patch",
    summary: "Applied patch.",
    patch_summary: "Add GMV trend chart.",
    focused_view_id: "v_gmv_trend",
    dashboard: candidate,
  });
  assert.match(applyText, /suggestion_id: patch_boundary/);
  assert.doesNotMatch(
    applyText,
    /dashboard_spec|query_defs|bindings|sql_template|option_template/,
  );

  const skillText = formatAuthoringToolResultText("loadSkill", {
    skill_id: "echarts-line",
    skill_directory: "src/ai/authoring/skills/echarts-line",
    content: "Use a line chart for time-series trends.",
  });
  assert.match(skillText, /Loaded skill: echarts-line/);
  assert.match(skillText, /Use a line chart for time-series trends/);

  const schemaText = formatAuthoringToolResultText("getSchemaByDatasource", {
    datasource_id: "testing-db",
    dialect: "postgres",
    tables: [{ name: "sales_weekly_fact", fields: [{ name: "gmv", type: "number" }] }],
    visibility_scope: { allowed_tables: ["sales_weekly_fact"], allowed_fields: ["gmv"] },
  });
  assert.match(schemaText, /sales_weekly_fact/);
  assert.match(schemaText, /gmv/);

  const fallbackText = formatAuthoringToolResultText("unknownTool", {
    nested: { dashboard_spec: candidate.dashboard_spec },
  });
  assert.equal(fallbackText, "unknownTool completed.");
});

test("tool result formatter covers every canonical authoring tool", () => {
  const compactView = {
    id: "v_gmv_trend",
    title: "GMV Trend",
    renderer_kind: "line",
  };
  const canonicalOutputs: Record<string, unknown> = {
    loadSkill: {
      skill_id: "echarts-line",
      skill_directory: "skills/echarts-line",
      content: "Line chart skill manual.",
    },
    getViews: {
      dashboard_name: "Reliability Dashboard",
      dashboard_id: "db_test",
      view_count: 1,
      views: [compactView],
    },
    getView: {
      match_status: "exact",
      view: { view: compactView, query_ids: ["q_gmv_trend"] },
    },
    getDatasources: {
      datasource_count: 1,
      datasources: [{ datasource_id: "testing-db", label: "testing-db" }],
    },
    getSchemaByDatasource: {
      datasource_id: "testing-db",
      dialect: "postgres",
      tables: [{ name: "sales_weekly_fact", fields: [{ name: "gmv", type: "number" }] }],
    },
    getQuery: {
      query: { id: "q_gmv_trend", name: "GMV Trend", datasource_id: "testing-db" },
      used_by: [{ binding_id: "b1", view_id: "v_gmv_trend", slot_id: "series" }],
    },
    getBinding: {
      binding: { id: "b1", view_id: "v_gmv_trend", slot_id: "series", query_id: "q_gmv_trend" },
    },
    getDraftStatus: {
      summary: "Draft is ready.",
      has_draft: true,
      can_compose: true,
      blockers: [],
    },
    declareAuthoringGoal: {
      accepted: true,
      declaredIntentKind: "create_view",
      activeGoalId: "goal_1",
      message: "Goal declared.",
    },
    runCheck: {
      status: "ok",
      reason: "Runtime check passed.",
      checks: [{ view_id: "v_gmv_trend", status: "ok", query_ids: [], binding_ids: [] }],
      failures: [],
      renderer_checks: [{ view_id: "v_gmv_trend", checks: {} }],
    },
    upsertView: {
      summary: "Staged view.",
      view: {
        id: "v_gmv_trend",
        title: "GMV Trend",
        renderer_kind: "line",
        renderer: { option_template: { series: [{ data: [1, 2, 3] }] } },
      },
    },
    upsertQuery: {
      summary: "Staged query.",
      query: {
        id: "q_gmv_trend",
        name: "GMV Trend",
        datasource_id: "testing-db",
        sql_template: "select * from sales_weekly_fact",
      },
    },
    upsertBinding: {
      summary: "Staged binding.",
      bindings: [
        {
          binding: {
            id: "b1",
            view_id: "v_gmv_trend",
            slot_id: "series",
            query_id: "q_gmv_trend",
          },
        },
      ],
    },
    upsertLayout: {
      summary: "Staged layout.",
      layout: { desktop: { view_id: "v_gmv_trend" }, mobile: { view_id: "v_gmv_trend" } },
    },
    deleteView: {
      summary: "Removed view.",
      view_id: "v_gmv_trend",
      removed_binding_ids: ["b1"],
    },
    deleteQuery: {
      summary: "Removed query.",
      query_id: "q_gmv_trend",
      removed_binding_ids: ["b1"],
    },
    deleteBinding: {
      summary: "Removed binding.",
      binding_id: "b1",
      view_id: "v_gmv_trend",
    },
    composePatch: {
      suggestion: {
        id: "patch_canonical",
        kind: "data",
        title: "Canonical patch",
        summary: "Prepared patch.",
        patch: {
          summary: "Patch summary.",
          operations: [{ op: "add", path: "dashboard_spec.views.0" }],
        },
        dashboard: baseDocument(),
      },
      approval: {
        status: "pending",
        summary: "Review patch.",
        operation_count: 1,
        affected_paths: ["dashboard_spec.views.0"],
      },
      draft_fingerprint: "fp_canonical",
      base_version: 1,
    },
    applyPatch: {
      applied: true,
      suggestion_id: "patch_canonical",
      kind: "data",
      title: "Canonical patch",
      summary: "Applied patch.",
      patch_summary: "Patch summary.",
      focused_view_id: "v_gmv_trend",
      dashboard: baseDocument(),
    },
  };

  const missing = AUTHORING_TOOL_REGISTRY
    .map((definition) => definition.name)
    .filter((name) => !(name in canonicalOutputs));
  assert.deepEqual(missing, []);

  for (const definition of AUTHORING_TOOL_REGISTRY) {
    const text = formatAuthoringToolResultText(
      definition.name,
      canonicalOutputs[definition.name],
    );
    assert.notEqual(text.trim(), "");
    assert.doesNotMatch(
      text,
      /providerOptions|providerMetadata|callProviderMetadata|resultProviderMetadata|item_reference/,
      definition.name,
    );
  }

  for (const toolName of [
    "composePatch",
    "applyPatch",
    "upsertView",
    "upsertQuery",
    "upsertBinding",
    "upsertLayout",
    "deleteView",
    "deleteQuery",
    "deleteBinding",
  ]) {
    const text = formatAuthoringToolResultText(
      toolName,
      canonicalOutputs[toolName],
    );
    assert.doesNotMatch(
      text,
      /dashboard_spec|query_defs|bindings|sql_template|option_template/,
      toolName,
    );
  }
});

test("provider payload guard rejects runtime metadata and OpenAI item refs", () => {
  assert.equal(
    inspectProviderPayloadBoundary({
      input: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    }).safe,
    true,
  );
  assert.equal(
    inspectProviderPayloadBoundary({
      input: [
        { role: "user", content: [{ type: "text", text: "literal msg_stale text" }] },
      ],
    }).safe,
    true,
  );

  assert.equal(
    inspectProviderPayloadBoundary({
      input: [
        {
          role: "assistant",
          providerOptions: { openai: { itemId: "msg_stale" } },
        },
      ],
    }).safe,
    false,
  );

  assert.equal(
    inspectProviderPayloadBoundary({
      input: [{ type: "item_reference", id: "rs_stale" }],
    }).safe,
    false,
  );

  assert.throws(
    () =>
      assertProviderPayloadBoundary({
        input: [{ type: "function_call", id: "fc_stale" }],
      }),
    /Provider payload boundary violation/,
  );
});

test("convertToLlm rewrites unsafe persisted tool result content from details", () => {
  const unsafeOutput = {
    suggestion: {
      id: "patch_unsafe",
      kind: "data",
      title: "Unsafe Patch",
      summary: "Prepared unsafe patch.",
      details: [],
      patch: {
        summary: "Unsafe full patch.",
        operations: [
          { op: "add", path: "dashboard_spec.views.0", summary: "Add view." },
        ],
      },
      dashboard: {
        dashboard_spec: baseDocument().dashboard_spec,
        query_defs: [timeSeriesQuery()],
        bindings: [],
      },
    },
    approval: {
      required: true,
      status: "pending",
      summary: "Review patch.",
      operation_count: 1,
      affected_paths: ["dashboard_spec.views.0"],
    },
    draft_fingerprint: "fp_unsafe",
    stabilization: { status: "not-needed", checked: true, notes: [] },
  };

  const llmMessages = convertToLlm([
    {
      role: "toolResult",
      toolCallId: "call_unsafe",
      toolName: "composePatch",
      content: [{ type: "text", text: JSON.stringify(unsafeOutput) }],
      details: unsafeOutput,
      isError: false,
      timestamp: 4,
    },
  ] as never);
  const serialized = JSON.stringify(llmMessages);
  assert.match(serialized, /patch_unsafe/);
  assert.doesNotMatch(
    serialized,
    /dashboard_spec|query_defs|bindings|sql_template|option_template/,
  );
});

test("agent event reducer dedupes tool result event projections", () => {
  const toolResult = {
    role: "toolResult",
    toolCallId: "call_patch",
    toolName: "composePatch",
    content: [{ type: "text", text: "composePatch completed." }],
    details: { suggestion: { id: "patch_event" } },
    isError: false,
    timestamp: 12,
  };

  let messages = reduceAgentEventToUiMessages([], {
    type: "tool_execution_end",
    toolCallId: "call_patch",
    toolName: "composePatch",
    args: {},
    result: {
      content: [{ type: "text", text: "composePatch completed." }],
      details: { suggestion: { id: "patch_event" } },
    },
    isError: false,
  } as never);

  messages = reduceAgentEventToUiMessages(messages, {
    type: "message_end",
    message: toolResult,
  } as never);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(
    messages[0].parts.filter((part) => part.type === "tool-composePatch").length,
    1,
  );
  assert.deepEqual(
    messages[0].parts.find((part) => part.type === "tool-composePatch")?.output,
    { suggestion: { id: "patch_event" } },
  );

  const restored = projectAgentMessagesToUiMessages([toolResult] as never);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].parts[0].type, "tool-composePatch");
});

test("working indicator describes long-running reasoning and tool-call phases", () => {
  const userOnly = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "做 GMV 趋势" }],
    },
  ] as AuthoringUiMessage[];

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
      ] as AuthoringUiMessage[],
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
      ] as AuthoringUiMessage[],
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
      ] as AuthoringUiMessage[],
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
  ] as AuthoringUiMessage[];

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
  ] as AuthoringUiMessage[];

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
      ] as AuthoringUiMessage[],
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
      ] as AuthoringUiMessage[],
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
      ] as AuthoringUiMessage[],
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
      ] as AuthoringUiMessage[],
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
      ] as AuthoringUiMessage[],
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
              type: "tool-loadSkill",
              state: "output-available",
              toolCallId: "call_8",
              input: {},
              output: { summary: "Loaded." },
            },
          ],
        },
      ] as AuthoringUiMessage[],
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
  const workflowState = {
    goals: [{
      id: "goal_orders",
      kind: "create_view" as const,
      status: "active" as const,
      summary: "Orders trend",
      dataMode: "live" as const,
      chartPlan: { chartSkillId: "echarts-line" as const },
      targetRefs: { datasourceId: "testing-db", table: "orders" },
      blockers: [],
      createdFromTurnId: "turn_orders",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    }],
    activeGoalId: "goal_orders",
  };

  const dashboardContext = buildAuthoringContextBlock({
    variant: "dashboard",
    dashboard: document,
    draftStatus,
    workflowState,
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
    workflowState,
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
  assert.equal(dashboardEnvelope.workflow?.active_goal?.id, "goal_orders");
  assert.equal(dashboardEnvelope.workflow?.active_goal?.chart_skill_id, "echarts-line");
  assert.equal("lifecycle" in dashboardEnvelope, false);
  assert.equal("action" in (dashboardEnvelope.workflow ?? {}), false);
  const workflowJson = JSON.stringify(dashboardEnvelope.workflow);
  assert.doesNotMatch(workflowJson, /"tool":/);
  assert.doesNotMatch(workflowJson, /"reason":/);
  assert.doesNotMatch(workflowJson, /"blocker":/);
  assert.doesNotMatch(workflowJson, /"reference_kind":/);
  assert.equal(focusedEnvelope.scope_resolution.effective_scope, "focused");
  assert.equal(focusedEnvelope.scope_resolution.selected_view_id, "v_orders");
  assert.notEqual(dashboardContext.fingerprint, focusedContext.fingerprint);
});

test("workflow inspection reads current authoring scope data parts", () => {
  const workflow = findLatestWorkflow([
    {
      id: "assistant_scope",
      role: "assistant",
      parts: [
        {
          type: "data-authoring_scope",
          data: {
            profile: "author-dashboard",
            scope: { kind: "dashboard" },
            allowedTools: ["getDraftStatus", "upsertView"],
            relevantSkillIds: ["echarts-line"],
            stopReason: null,
          },
        },
      ],
    },
  ] as unknown as AuthoringUiMessage[]);

  assert.equal(workflow?.mode, "author-dashboard");
  assert.deepEqual(workflow?.active_tools, ["getDraftStatus", "upsertView"]);
  assert.deepEqual(workflow?.skill_ids, ["echarts-line"]);
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
          stabilization: {
            status: "not-needed",
            checked: true,
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
          stabilization: {
            status: "not-needed",
            checked: true,
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

test("skill catalog exposes independent chart skills and loadSkill returns the manual", async () => {
  const loadedSkills = await listAuthoringSkills();
  const ids = loadedSkills.map((skill) => skill.id);
  assert.ok(ids.includes("echarts-line"));
  assert.ok(ids.includes("echarts-bar"));
  assert.ok(ids.includes("echarts-kpi-text"));
  assert.ok(ids.includes("echarts-kpi-gauge"));
  assert.equal(ids.includes("echarts-skills"), false);
  assert.equal(ids.includes("data-format-skills"), false);

  const lineSkill = await loadAuthoringSkill("echarts-line");
  assert.ok(lineSkill?.content.includes("ECharts Line Skill"));
  assert.equal(lineSkill?.content.includes("skill-check"), false);
});

test("tool runtime records loaded chart skills in context status", async () => {
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: {
      ...createValidationOnlyAuthoringDependencies(),
      loadSkill: loadAuthoringSkill,
    },
  });
  await executeTool(runtime.tools.loadSkill, {
    name: "echarts-line",
  });

  const status = runtime.getContextStatusSnapshot({
    id: "goal_1",
    kind: "create_view",
    status: "active",
    summary: "Create GMV trend",
    dataMode: "live",
    chartPlan: { chartSkillId: "echarts-line" },
    targetRefs: { datasourceId: "testing-db" },
    blockers: [],
    createdFromTurnId: "turn_1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  });

  assert.equal(status.chartSkillLoadedFor?.skillId, "echarts-line");
  assert.ok(status.availableChartSkillIds.includes("echarts-line"));
});

test("failed datasource preload leaves datasource context retryable", () => {
  const failedPreloadRuntime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: null,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
  });
  const emptyLoadedRuntime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: [],
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
  });

  assert.equal(
    failedPreloadRuntime.getContextStatusSnapshot(null).datasourcesLoaded,
    false,
  );
  assert.equal(
    emptyLoadedRuntime.getContextStatusSnapshot(null).datasourcesLoaded,
    true,
  );
});

test("authoring tool registry covers canonical tools and inspect lane excludes write tools", () => {
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
  });
  const registeredToolNames = Object.keys(runtime.tools).sort();
  const registryToolNames = AUTHORING_TOOL_REGISTRY.map((definition) => definition.name).sort();

  assert.deepEqual(registryToolNames, registeredToolNames);
  assert.deepEqual(
    getInspectLaneToolNames().sort(),
    AUTHORING_TOOL_REGISTRY
      .filter((definition) => definition.inspectLane)
      .map((definition) => definition.name)
      .sort(),
  );
  assert.equal(getInspectLaneToolNames().includes("upsertQuery"), false);
  assert.equal(getInspectLaneToolNames().includes("composePatch"), false);
  assert.equal(getInspectLaneToolNames().includes("declareAuthoringGoal"), true);
});

test("runtime tool surface exposes inspect tools before workflow writes", () => {
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
  });
  const surface = buildInspectToolSurface({ scope: { kind: "dashboard" } });
  const selected = selectAuthoringToolSet({
    tools: runtime.tools,
    activeTools: surface.activeTools,
  });
  const selectedNames = Object.keys(selected).sort();

  assert.equal(surface.toolChoice, "auto");
  assert.equal(selectedNames.includes("declareAuthoringGoal"), true);
  assert.equal(selectedNames.includes("getDatasources"), true);
  assert.equal(selectedNames.includes("getSchemaByDatasource"), true);
  assert.equal(selectedNames.includes("upsertView"), false);
  assert.equal(selectedNames.includes("composePatch"), false);
  assert.equal(selectedNames.includes("applyPatch"), false);
});

test("runtime workflow surface narrows to the prepared active tool", () => {
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
  });
  const surface = buildWorkflowToolSurface({
    action: { kind: "stage_view", tool: "upsertView" },
    step: {
      mode: "forced",
      activeTools: ["upsertView"],
      toolChoice: { type: "tool", toolName: "upsertView" },
    },
    scope: { kind: "dashboard" },
  });
  const selected = selectAuthoringToolSet({
    tools: runtime.tools,
    activeTools: surface.activeTools,
  });

  assert.deepEqual(Object.keys(selected), ["upsertView"]);
  assert.deepEqual(surface.promptSections, ["identity", "stage_view", "dashboard"]);
});

test("declareAuthoringGoal is declarative and delegates goal state to the runtime", async () => {
  const declarations: unknown[] = [];
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
    onDeclareAuthoringGoal: (declaration) => {
      declarations.push(declaration);
      return {
        accepted: true,
        declaredIntentKind: declaration.kind,
        activeGoalId: "goal_test",
        message: "declared",
      };
    },
  });

  const output = await executeTool(runtime.tools.declareAuthoringGoal, {
    kind: "create_view",
    goal: { summary: "GMV trend", chartSkillId: "echarts-line", dataMode: "live" },
  });

  assert.deepEqual(declarations, [
    {
      kind: "create_view",
      goal: { summary: "GMV trend", chartSkillId: "echarts-line", dataMode: "live" },
    },
  ]);
  assert.deepEqual(output, {
    accepted: true,
    declaredIntentKind: "create_view",
    activeGoalId: "goal_test",
    message: "declared",
  });
  assert.equal(runtime.getDraftSnapshot(), null);
});

test("declareAuthoringGoal exposes a strict-provider compatible object schema", () => {
  const runtime = buildAuthoringTools({
    scope: { kind: "dashboard" },
    dashboard: baseDocument(),
    dashboardId: "db_test",
    datasources: dashboardBase.datasources,
    skills,
    dependencies: createValidationOnlyAuthoringDependencies(),
  });
  const schema = (runtime.tools.declareAuthoringGoal as { inputSchema?: unknown })
    .inputSchema;
  const jsonSchema = z.toJSONSchema(schema as Parameters<typeof z.toJSONSchema>[0]) as {
    type?: unknown;
    properties?: Record<string, unknown>;
  };

  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties?.kind);
  assert.ok(jsonSchema.properties?.goal);
  assert.ok(jsonSchema.properties?.dataMode);
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
  const lineSkill = await loadAuthoringSkill("echarts-line");
  assert.ok(lineSkill);

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
          toolName: "loadSkill",
          input: JSON.stringify({
            name: "echarts-line",
          }),
        },
      ],
      toolResults: [
        { toolName: "loadSkill", output: lineSkill },
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
              "upsertView requires the active chart skill to be loaded.",
            recoveryHint:
              "Load the echarts-line chart skill before retrying.",
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
    sections: ["identity", "stage_query", "dashboard"],
    scope: { kind: "dashboard" },
    skills,
  });
  assert.match(prompt, /Current action: call upsertQuery/i);
  assert.doesNotMatch(prompt, /Current task state/i);
  assert.doesNotMatch(prompt, /last failed authoring tool/i);
  assert.doesNotMatch(prompt, /repair the failed draft artifact/i);
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

  const strictStatus = buildDraftStatus({
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
      createdFromTurnId: "turn",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    },
  });
  assert.equal(strictStatus.can_compose, true);
  assert.equal(strictStatus.blockers.includes("unresolved_tool_failure"), false);
  assert.equal(strictStatus.unresolved_failure, null);
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
      createdFromTurnId: "turn",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    },
  });
  assert.equal(failedStatus.blockers.includes("unresolved_tool_failure"), false);
  assert.equal(failedStatus.unresolved_failure, null);
});

test("agent workflow uses pi runtime and no AI SDK runtime", async () => {
  const source = await readFile(
    new URL("../src/ai/authoring/agent.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, new RegExp("derive" + "AuthoringLifecycleDecision"));
  assert.match(source, /@mariozechner\/pi-agent-core/);
  assert.match(source, /convertToLlm/);
  assert.doesNotMatch(source, /ToolLoopAgent/);
  assert.doesNotMatch(source, /createUIMessageStream/);
  assert.doesNotMatch(source, /extractTurnIntent/);
  assert.doesNotMatch(source, /TOOL_NAME_ALIASES/);
  assert.doesNotMatch(source, /enforceWorkflowToolCapability/);
  assert.doesNotMatch(source, /prepareForcedToolStep/);
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
    focusedViewId: null,
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
    focusedViewId: null,
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

test("composePatch allows focused-view proposals and rejects focused-scope patch drift", async () => {
  const current = baseDocument();
  const view = {
    id: "v_gmv_trend",
    title: "GMV Trend",
    renderer: lineViewSpec().renderer,
  };
  current.dashboard_spec.views = [view];
  current.dashboard_spec.layout = {
    desktop: {
      cols: 12,
      row_height: 80,
      items: [{ view_id: view.id, x: 0, y: 0, w: 8, h: 6 }],
    },
    mobile: {
      cols: 4,
      row_height: 80,
      items: [{ view_id: view.id, x: 0, y: 0, w: 4, h: 6 }],
    },
  };
  current.query_defs = [timeSeriesQuery()];
  current.bindings = [
    {
      id: "b_gmv_x",
      view_id: view.id,
      slot_id: "x",
      mode: "live",
      query_id: "q_gmv_trend",
      param_mapping: {},
      result_selector: "rows[].bucket_date",
    },
    {
      id: "b_gmv_y",
      view_id: view.id,
      slot_id: "y",
      mode: "live",
      query_id: "q_gmv_trend",
      param_mapping: {},
      result_selector: "rows[].metric_value",
    },
  ];
  assert.throws(
    () =>
      assertFocusedPatchBoundary({
        focusedViewId: view.id,
        patch: {
          summary: "Move a focused binding outside the selected card.",
          operations: [
            {
              op: "upsert",
              path: "bindings.b_gmv_x",
              summary: "Update binding target.",
            },
          ],
        },
        before: {
          layout: current.dashboard_spec.layout,
          bindings: current.bindings,
          queries: current.query_defs,
        },
        after: {
          layout: current.dashboard_spec.layout,
          bindings: current.bindings.map((binding) =>
            binding.id === "b_gmv_x"
              ? { ...binding, view_id: "v_outside" }
              : binding,
          ),
          queries: current.query_defs,
        },
      }),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "scope_violation");
      assert.match(error.userSafeSummary, /binding "b_gmv_x"/);
      return true;
    },
  );

  const workingDraft = createWorkingDraftState(null);
  workingDraft.dashboardSpec = {
    ...current.dashboard_spec,
    views: [{ ...view, title: "GMV Trend Updated" }],
    layout: current.dashboard_spec.layout,
  };
  workingDraft.dirtyViewIds.add(view.id);
  workingDraft.bindingMode = "live";
  markWorkingDraftArtifactOwner({
    workingDraft,
    goalId: "goal_1",
    artifactKind: "view",
    artifactId: view.id,
  });
  const dependencies = {
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
  };
  const focusedCandidate = buildCandidateDocument(current, workingDraft);
  const fingerprint = buildDocumentFingerprint(focusedCandidate);
  const composePatch = buildComposePatchTool({
    dashboard: current,
    focusedViewId: view.id,
    dependencies,
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
  assert.match(JSON.stringify(output), /GMV Trend Updated/);

  const driftDraft = createWorkingDraftState(null);
  driftDraft.dashboardSpec = {
    ...current.dashboard_spec,
    views: [
      view,
      {
        id: "v_outside",
        title: "Outside View",
        renderer: {
          ...lineViewSpec("bar").renderer,
          slots: lineViewSpec("bar").renderer.slots.map((slot) => ({
            ...slot,
            required: false,
          })),
        },
      },
    ],
    layout: {
      desktop: {
        cols: 12,
        row_height: 80,
        items: [
          ...(current.dashboard_spec.layout.desktop?.items ?? []),
          { view_id: "v_outside", x: 8, y: 0, w: 4, h: 6 },
        ],
      },
      mobile: {
        cols: 4,
        row_height: 80,
        items: [
          ...(current.dashboard_spec.layout.mobile?.items ?? []),
          { view_id: "v_outside", x: 0, y: 6, w: 4, h: 6 },
        ],
      },
    },
  };
  driftDraft.dirtyViewIds.add("v_outside");
  driftDraft.bindingMode = "live";
  const driftCandidate = buildCandidateDocument(current, driftDraft);
  const driftFingerprint = buildDocumentFingerprint(driftCandidate);
  const driftComposePatch = buildComposePatchTool({
    dashboard: current,
    focusedViewId: view.id,
    dependencies,
    workingDraft: driftDraft,
    getLastRunCheckState: () => ({
      fingerprint: driftFingerprint,
      signatures: [],
      consecutive_repeat_count: 0,
    }),
    setLatestProposalMeta: () => {},
    buildCandidateDocument,
    buildDocumentFingerprint,
  });

  await assert.rejects(
    () => executeTool(driftComposePatch, {}),
    (error) => {
      assert.ok(error instanceof AuthoringToolGateError);
      assert.equal(error.code, "scope_violation");
      assert.match(error.userSafeSummary, /focused view/i);
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
  const pendingFingerprint = buildDocumentFingerprint(
    buildCandidateDocument(document, workingDraft),
  );

  const applyPatch = buildApplyPatchTool({
    dashboard: document,
    dependencies: createValidationOnlyAuthoringDependencies(),
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
    getRuntimeApprovalContext: () => ({
      approved: true,
      proposalId: "patch-test",
      baseVersion: 1,
      pendingProposalId: "patch-test",
      pendingProposalBaseVersion: 1,
      draftFingerprint: pendingFingerprint,
    }),
    buildCandidateDocument,
    buildDocumentFingerprint,
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
    workingDraft,
    resetWorkingDraft: () => {},
    recordMutation: () => {},
    getLatestProposalMeta: () => null,
    getRuntimeApprovalContext: () => ({ approved: true }),
    buildCandidateDocument,
    buildDocumentFingerprint,
  });
  const normalPatch = buildApplyPatchTool({
    dashboard: baseDocument(),
    dependencies: createValidationOnlyAuthoringDependencies(),
    workingDraft,
    resetWorkingDraft: () => {},
    recordMutation: () => {},
    getLatestProposalMeta: () => null,
    getRuntimeApprovalContext: () => ({ approved: false }),
    buildCandidateDocument,
    buildDocumentFingerprint,
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

test("applyPatch execute hard-rejects invalid runtime approval context", async () => {
  const createPatchTool = (input: {
    approval: {
      approved: boolean;
      proposalId?: string | null;
      baseVersion?: number | null;
      pendingProposalId?: string | null;
      pendingProposalBaseVersion?: number | null;
      draftFingerprint?: string | null;
    };
    inputSuggestionId?: string;
  }) => {
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
    const fingerprint = buildDocumentFingerprint(
      buildCandidateDocument(document, workingDraft),
    );
    let reset = false;
    const tool = buildApplyPatchTool({
      dashboard: document,
      dependencies: createValidationOnlyAuthoringDependencies(),
      workingDraft,
      resetWorkingDraft: () => {
        reset = true;
      },
      recordMutation: () => {},
      getLatestProposalMeta: () => ({
        suggestionId: "patch-test",
        kind: "layout",
        title: "GMV Trend",
        summary: "Prepared GMV trend.",
        patchSummary: "Patch summary.",
      }),
      getRuntimeApprovalContext: () => ({
        ...input.approval,
        draftFingerprint: input.approval.draftFingerprint ?? fingerprint,
      }),
      buildCandidateDocument,
      buildDocumentFingerprint,
    });
    return { tool, reset: () => reset, inputSuggestionId: input.inputSuggestionId };
  };

  for (const scenario of [
    {
      approval: { approved: false },
      message: /matching local UI approval event/i,
    },
    {
      approval: {
        approved: true,
        proposalId: "patch-other",
        baseVersion: 1,
        pendingProposalId: "patch-test",
        pendingProposalBaseVersion: 1,
      },
      message: /approved proposal does not match/i,
    },
    {
      approval: {
        approved: true,
        proposalId: "patch-test",
        baseVersion: 2,
        pendingProposalId: "patch-test",
        pendingProposalBaseVersion: 1,
      },
      message: /approved dashboard version is stale/i,
    },
    {
      approval: {
        approved: true,
        proposalId: "patch-test",
        baseVersion: 1,
        pendingProposalId: "patch-test",
        pendingProposalBaseVersion: 1,
        draftFingerprint: "stale-fingerprint",
      },
      message: /staged draft changed/i,
    },
    {
      approval: {
        approved: true,
        proposalId: "patch-test",
        baseVersion: 1,
        pendingProposalId: "patch-test",
        pendingProposalBaseVersion: 1,
      },
      inputSuggestionId: "patch-other",
      message: /different from the approved proposal/i,
    },
  ]) {
    const { tool, reset, inputSuggestionId } = createPatchTool(scenario);
    await assert.rejects(
      () => executeTool(tool, { suggestion_id: inputSuggestionId ?? "patch-test" }),
      scenario.message,
    );
    assert.equal(reset(), false);
  }
});

test("all first-class chart skills are independent SKILL.md packages", async () => {
  const loadedSkills = await listAuthoringSkills();
  const skillIds = loadedSkills.map((skill) => skill.id);
  assert.deepEqual(
    skillIds.filter((id) => id.startsWith("echarts-")).sort(),
    ["echarts-bar", "echarts-kpi-gauge", "echarts-kpi-text", "echarts-line"],
  );

  for (const skillId of ["echarts-line", "echarts-bar", "echarts-kpi-text", "echarts-kpi-gauge"]) {
    const skill = await loadAuthoringSkill(skillId);
    assert.ok(skill, `${skillId} should load`);
    assert.equal(skill.content.includes("skill-check"), false);
    assert.match(skill.content, /Renderer Guidance/);
    assert.match(skill.content, /Query Output Contract/);
    assert.match(skill.content, /Binding Guidance/);
  }
});

test("write tools can create a line time-series draft after the chart skill is loaded", async () => {
  const harness = makeToolHarness();

  await executeTool(harness.upsertQuery, {
    query: timeSeriesQuery(),
  });
  await executeTool(harness.upsertView, {
    request: "Create weekly GMV trend",
    view_spec: lineViewSpec(),
  });
  assert.equal(harness.candidate().bindings.length, 0);
  await executeTool(harness.upsertBinding, {
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
  const harness = makeToolHarness();

  await executeTool(harness.upsertView, {
    request: "Create weekly GMV trend with mock placeholders",
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
  const harness = makeToolHarness();

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

test("chart skills are self-contained and avoid business table examples", async () => {
  for (const skillId of ["echarts-line", "echarts-bar", "echarts-kpi-text", "echarts-kpi-gauge"]) {
    const skill = await readFile(
      `src/ai/authoring/skills/${skillId}/SKILL.md`,
      "utf8",
    );
    assert.match(skill, /Renderer Guidance/);
    assert.match(skill, /Query Output Contract/);
    assert.match(skill, /Binding Guidance/);
    assert.doesNotMatch(skill, /public\.sales_/i);
    assert.doesNotMatch(skill, /skill-check/i);
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

test("skill loading tool description is scoped to runtime-selected context", () => {
  const skillTool = buildLoadSkillTool({
    skillCatalog: new Map(),
    loadSkill: async () => null,
  });

  assert.match(skillTool.description ?? "", /runtime-selected step/i);
  assert.doesNotMatch(skillTool.description ?? "", /continue with/i);
  assert.doesNotMatch(skillTool.description ?? "", /not a final action/i);
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
