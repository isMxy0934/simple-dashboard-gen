import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  MainAgentMessage,
  MainAgentSkillSummary,
  MainAgentTools,
  MainAgentWorkflowStage,
  MainAgentWorkflowSummary,
} from "@/ai/main-agent/contracts/agent-contract";
import {
  buildMainAgentRouteDecision,
  type MainAgentRouteDecision,
} from "@/ai/main-agent/contracts/route";
import {
  findLatestDraftOutput,
  findLatestWorkflow,
  hasPendingApprovalResponse,
  hasPendingToolApproval,
} from "@/ai/main-agent/messages/message-inspection";
import { extractLatestUserText } from "@/ai/shared/messages/extract-latest-user-text";
import {
  buildKeywordPattern,
  buildWorkerStages,
  buildWorkerWorkflowSummary,
  detectStructuredAuthoringContext,
} from "@/ai/shared/worker/workflow-core";
import { buildWorkerSystemPrompt } from "@/ai/view-worker/prompt";
import { buildMainAgentTools } from "@/ai/view-worker/tools/tools";
import type { MainAgentDependencies } from "@/ai/main-agent/engine/dependencies";
import type { ViewCheckSnapshot } from "@/ai/main-agent/contracts/agent-contract";
import type { MainAgentWorkingDraftSnapshot } from "@/ai/main-agent/contracts/session-state";

export type ActiveWorkerToolName = keyof MainAgentTools & string;

export interface WorkerEngineControl {
  mode: "read" | "write" | "approval";
  summary: string;
  activeTools: ActiveWorkerToolName[];
}

export interface WorkerWorkflow {
  latestUserRequest: string;
  routeDecision: MainAgentRouteDecision;
  engineControl: WorkerEngineControl;
  summary: MainAgentWorkflowSummary;
  instructions: string;
  tools: ReturnType<typeof buildMainAgentTools>["tools"];
  getDraftSnapshot: () => MainAgentWorkingDraftSnapshot | null;
  activeTools: ActiveWorkerToolName[];
}
const ECHARTS_SKILL_ID = "echarts-skills";

export function createWorkerWorkflow(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: MainAgentSkillSummary[] | null;
  messages: MainAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: MainAgentWorkingDraftSnapshot | null;
  dependencies?: MainAgentDependencies;
}): WorkerWorkflow {
  const latestUserRequest =
    extractLatestUserText(input.messages) ??
    "Inspect the current dashboard and continue safely.";
  const hasPendingApproval = hasPendingToolApproval(input.messages);
  const pendingApprovalResponded = hasPendingApprovalResponse(input.messages);
  const routeDecision = buildMainAgentRouteDecision({
    request: latestUserRequest,
    hasRecentAuthoringContext: detectStructuredAuthoringContext(input.messages, [
      "tool-getView",
      "tool-getDatasources",
      "tool-getSchemaByDatasource",
      "tool-upsertView",
      "tool-upsertQuery",
      "tool-upsertBinding",
      "tool-deleteBinding",
      "tool-composePatch",
      "tool-applyPatch",
      "tool-runCheck",
    ]),
    hasPendingProposal: hasPendingApproval,
  });
  const engineControl = buildWorkerEngineControl({
    dashboard: input.dashboard,
    latestUserRequest,
    routeDecision,
    pendingApprovalResponded,
  });
  const toolRuntime = buildMainAgentTools({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    focusedViewId: input.focusedViewId,
    datasources: input.datasources,
    skills: input.skills,
    messages: input.messages,
    checks: input.checks,
    initialWorkingDraft: input.initialWorkingDraft,
    dependencies: input.dependencies,
  });

  return {
    latestUserRequest,
    routeDecision,
    engineControl,
    summary: buildWorkflowSummary({
      routeDecision,
      engineControl,
      latestUserRequest,
      skills: input.skills ?? [],
    }),
    instructions: buildWorkerSystemPrompt({
      skills: input.skills,
    }),
    tools: toolRuntime.tools,
    getDraftSnapshot: toolRuntime.getDraftSnapshot,
    activeTools: engineControl.activeTools,
  };
}

export function buildWorkerConversationReply(input: {
  dashboard: DashboardDocument;
  messages: MainAgentMessage[];
  routeDecision: MainAgentRouteDecision;
}) {
  const dashboardName = input.dashboard.dashboard_spec.dashboard.name;
  const latestProposal = findLatestDraftOutput(input.messages);

  if (input.routeDecision.route === "approval") {
    return latestProposal
      ? `当前有一个待审批提案「${latestProposal.suggestion.title}」。请先审批，或者明确说明要撤回 / 继续修改。`
      : "当前没有待审批提案。告诉我你想检查还是修改哪个 view。";
  }

  if (input.routeDecision.route === "chat") {
    if (input.routeDecision.signals.includes("capabilities-question")) {
      return [
        "我可以帮你做 4 类事情：",
        "1. 先搭出图表和布局",
        "2. 再补查询和数据绑定",
        "3. 检查并修复数据/渲染问题",
        "4. 调整现有 dashboard 的标题、文案、图表形式和布局",
        "",
        "如果你想开始，直接告诉我你想看什么指标或问题。",
      ].join("\n");
    }
    return `可以。告诉我你想在「${dashboardName}」里修改哪个 view，或者想检查什么问题。`;
  }

  return `告诉我你想在「${dashboardName}」里检查或修改什么，我会先读取状态，再补齐缺的 contract。`;
}

export function buildFallbackWorkflowStages(
  activeStage: MainAgentWorkflowStage["id"],
): MainAgentWorkflowStage[] {
  return buildWorkerStages(activeStage);
}

function buildWorkflowSummary(input: {
  routeDecision: MainAgentRouteDecision;
  engineControl: WorkerEngineControl;
  latestUserRequest: string;
  skills: MainAgentSkillSummary[];
}): MainAgentWorkflowSummary {
  return buildWorkerWorkflowSummary({
    routeDecision: input.routeDecision,
    mode: input.engineControl.mode,
    summary: input.engineControl.summary,
    activeTools: input.engineControl.activeTools,
    latestUserRequest: input.latestUserRequest,
    skills: input.skills,
    resolveRelevantSkillIds,
  });
}

function buildWorkerEngineControl(input: {
  dashboard: DashboardDocument;
  latestUserRequest: string;
  routeDecision: MainAgentRouteDecision;
  pendingApprovalResponded?: boolean;
}): WorkerEngineControl {
  // Round 2: user already approved — run applyPatch directly without re-proposing
  if (input.pendingApprovalResponded) {
    return {
      mode: "write",
      summary: "The user has approved the staged patch. Execute applyPatch immediately without calling composePatch again.",
      activeTools: ["applyPatch"],
    };
  }

  if (input.routeDecision.route === "approval") {
    return {
      mode: "approval",
      summary: "A staged patch is pending approval.",
      activeTools: ["applyPatch"],
    };
  }

  if (input.routeDecision.route === "chat") {
    return {
      mode: "read",
      summary: "This turn stays in lightweight conversation mode and does not enter authoring writes.",
      activeTools: [],
    };
  }

  if (isExploratoryAuthoringQuestion(input.latestUserRequest)) {
    return {
      mode: "read",
      summary:
        "This turn is exploratory. Inspect the focused view, its binding, and datasource schema without staging dashboard-wide writes.",
      activeTools: [
        "getView",
        "getBinding",
        "getDatasources",
        "getSchemaByDatasource",
      ],
    };
  }

  if (input.dashboard.dashboard_spec.views.length === 0) {
    return {
      mode: "write",
      summary:
        "This turn should define the focused view contract and immediately request approval when ready.",
      activeTools: [
        "loadSkill",
        "loadSkillReference",
        "getView",
        "getDatasources",
        "getSchemaByDatasource",
        "upsertView",
        "composePatch",
        "applyPatch",
      ],
    };
  }

  return {
    mode: "write",
    summary:
      "This turn stays inside the focused view authoring loop and can inspect state, stage view/query/binding updates, and prepare an approval patch.",
      activeTools: [
        "loadSkill",
        "loadSkillReference",
        "getView",
        "getQuery",
        "getBinding",
        "getDatasources",
        "getSchemaByDatasource",
        "runCheck",
        "upsertView",
        "upsertQuery",
        "upsertBinding",
        "deleteBinding",
        "composePatch",
        "applyPatch",
      ],
    };
  }

function isExploratoryAuthoringQuestion(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const pattern = buildKeywordPattern([
    "哪些数据",
    "什么数据",
    "有哪些数据",
    "能创建哪些报表",
    "可以创建什么报表",
    "指标卡类型可以创建什么",
    "有哪些指标卡",
    "什么指标卡",
    "可以做哪些图表",
    "能做哪些图表",
    "what data can",
    "what reports can",
    "which reports can",
    "what kpi",
    "what metric cards",
    "what dashboards can",
  ]);

  return pattern.test(trimmed);
}

function resolveRelevantSkillIds(
  latestUserRequest: string,
  skills: MainAgentSkillSummary[],
): string[] {
  const echartsSkill = skills.find((skill) => skill.id === ECHARTS_SKILL_ID);
  if (!echartsSkill) {
    return [];
  }

  const normalized = latestUserRequest.toLowerCase();
  if (
    /(kpi|指标卡|metric card|card|gauge|仪表盘|line|trend|timeseries|折线|趋势|时间序列|bar|柱状|条形|chart|view|report|dashboard|图表|视图|报表)/i.test(
      normalized,
    )
  ) {
    return [echartsSkill.id];
  }

  return [];
}

export function getSuggestedActiveStageFromMessages(
  messages: MainAgentMessage[],
): MainAgentWorkflowStage["id"] {
  const latest = findLatestWorkflow(messages);
  return latest?.active_stage ?? "read";
}
