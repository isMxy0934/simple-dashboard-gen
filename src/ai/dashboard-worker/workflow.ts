import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  DashboardAgentMessage,
  DashboardAgentSkillSummary,
  DashboardAgentTools,
  DashboardAgentWorkflowStage,
  DashboardAgentWorkflowSummary,
} from "@/ai/main-agent/contracts/agent-contract";
import {
  buildDashboardAgentRouteDecision,
  type DashboardAgentRouteDecision,
} from "@/ai/main-agent/contracts/route";
import {
  findLatestDraftOutput,
  findLatestWorkflow,
  hasPendingApprovalResponse,
  hasPendingToolApproval,
} from "@/ai/main-agent/messages/message-inspection";
import { buildDashboardAgentSystemPrompt } from "@/ai/dashboard-worker/prompt";
import { buildDashboardAgentTools } from "@/ai/dashboard-worker/tools/tools";
import type { DashboardAgentDependencies } from "@/ai/main-agent/engine/dependencies";
import type { ViewCheckSnapshot } from "@/ai/main-agent/contracts/agent-contract";
import type { DashboardAgentWorkingDraftSnapshot } from "@/ai/main-agent/contracts/session-state";

export type ActiveDashboardAgentToolName = keyof DashboardAgentTools & string;

export interface DashboardAgentEngineControl {
  mode: "read" | "write" | "approval";
  summary: string;
  activeTools: ActiveDashboardAgentToolName[];
}

export interface DashboardAgentWorkflow {
  latestUserRequest: string;
  routeDecision: DashboardAgentRouteDecision;
  engineControl: DashboardAgentEngineControl;
  summary: DashboardAgentWorkflowSummary;
  instructions: string;
  tools: ReturnType<typeof buildDashboardAgentTools>["tools"];
  getDraftSnapshot: () => DashboardAgentWorkingDraftSnapshot | null;
  activeTools: ActiveDashboardAgentToolName[];
}
const ECHARTS_SKILL_ID = "echarts-skills";

const STAGES: Array<Pick<DashboardAgentWorkflowStage, "id" | "title" | "description">> =
  [
    {
      id: "read",
      title: "Inspect State",
      description: "Read dashboard state, inspect a view, and run checks when needed.",
    },
    {
      id: "write",
      title: "Stage Changes",
      description: "Upsert view, query, and binding drafts for the current contract gap.",
    },
    {
      id: "approval",
      title: "Request Approval",
      description: "Compose the staged patch and hand it into approval.",
    },
  ];

export function createDashboardAgentWorkflow(input: {
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: DashboardAgentSkillSummary[] | null;
  messages: DashboardAgentMessage[];
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: DashboardAgentWorkingDraftSnapshot | null;
  dependencies?: DashboardAgentDependencies;
}): DashboardAgentWorkflow {
  const latestUserRequest =
    extractLatestUserText(input.messages) ??
    "Inspect the current dashboard and continue safely.";
  const hasPendingApproval = hasPendingToolApproval(input.messages);
  const pendingApprovalResponded = hasPendingApprovalResponse(input.messages);
  const routeDecision = buildDashboardAgentRouteDecision({
    request: latestUserRequest,
    hasRecentAuthoringContext: detectRecentAuthoringContext(input.messages),
    hasPendingProposal: hasPendingApproval,
  });
  const engineControl = buildDashboardAgentEngineControl({
    dashboard: input.dashboard,
    latestUserRequest,
    routeDecision,
    pendingApprovalResponded,
  });
  const toolRuntime = buildDashboardAgentTools({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
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
    instructions: buildDashboardAgentSystemPrompt({
      skills: input.skills,
    }),
    tools: toolRuntime.tools,
    getDraftSnapshot: toolRuntime.getDraftSnapshot,
    activeTools: engineControl.activeTools,
  };
}

export function buildDashboardConversationReply(input: {
  dashboard: DashboardDocument;
  messages: DashboardAgentMessage[];
  routeDecision: DashboardAgentRouteDecision;
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
  activeStage: DashboardAgentWorkflowStage["id"],
): DashboardAgentWorkflowStage[] {
  const activeIndex = STAGES.findIndex((stage) => stage.id === activeStage);

  return STAGES.map((stage, index) => ({
    ...stage,
    status:
      index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending",
  }));
}

function buildWorkflowSummary(input: {
  routeDecision: DashboardAgentRouteDecision;
  engineControl: DashboardAgentEngineControl;
  latestUserRequest: string;
  skills: DashboardAgentSkillSummary[];
}): DashboardAgentWorkflowSummary {
  return {
    route: input.routeDecision.route,
    mode: input.engineControl.mode,
    active_stage: input.engineControl.mode,
    summary: input.engineControl.summary,
    active_tools: input.engineControl.activeTools,
    skill_ids: resolveRelevantSkillIds(input.latestUserRequest, input.skills),
    approval_required: input.routeDecision.route === "approval",
    stages: buildFallbackWorkflowStages(input.engineControl.mode),
  };
}

function buildDashboardAgentEngineControl(input: {
  dashboard: DashboardDocument;
  latestUserRequest: string;
  routeDecision: DashboardAgentRouteDecision;
  pendingApprovalResponded?: boolean;
}): DashboardAgentEngineControl {
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
        "This turn is exploratory. Inspect available datasources, schema, and report options without staging dashboard writes.",
      activeTools: [
        "getViews",
        "getDatasources",
        "getSchemaByDatasource",
      ],
    };
  }

  if (input.dashboard.dashboard_spec.views.length === 0) {
    return {
      mode: "write",
      summary:
        "This turn should create and surface the first view layout only, then immediately request approval. Do not stage query or binding work yet.",
      activeTools: [
        "loadSkill",
        "loadSkillReference",
        "getViews",
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
      "This turn stays inside the unified authoring loop and can inspect state, stage updates, remove stale contract parts, and prepare an approval patch.",
      activeTools: [
        "loadSkill",
        "loadSkillReference",
        "getViews",
        "getView",
        "getQuery",
        "getBinding",
        "getDatasources",
        "getSchemaByDatasource",
        "runCheck",
        "delegateToViewAgent",
        "upsertView",
        "upsertQuery",
        "upsertBinding",
        "deleteView",
        "deleteQuery",
        "deleteBinding",
        "composePatch",
        "applyPatch",
      ],
    };
  }

function extractLatestUserText(messages: DashboardAgentMessage[]): string | null {
  const reversedMessages = [...messages].reverse();

  for (const message of reversedMessages) {
    if (message.role !== "user") {
      continue;
    }

    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return null;
}

function detectRecentAuthoringContext(messages: DashboardAgentMessage[]) {
  const recentMessages = [...messages].reverse().slice(0, 8);
  const authoringPattern =
    /(create|build|generate|make|design|add|edit|update|fix|repair|review|check|bind|query|dashboard|chart|view|layout|sql|gmv|orders|创建|生成|制作|设计|新增|修改|更新|修复|检查|绑定|查询|仪表板|图表|视图|布局|数据)/i;

  for (const message of recentMessages) {
    for (const part of message.parts) {
      if (part.type === "text" && authoringPattern.test(part.text)) {
        return true;
      }

      if (
        part.type === "tool-getViews" ||
        part.type === "tool-getView" ||
        part.type === "tool-getDatasources" ||
        part.type === "tool-getSchemaByDatasource" ||
        part.type === "tool-upsertView" ||
        part.type === "tool-upsertQuery" ||
        part.type === "tool-upsertBinding" ||
        part.type === "tool-deleteView" ||
        part.type === "tool-deleteQuery" ||
        part.type === "tool-deleteBinding" ||
        part.type === "tool-composePatch" ||
        part.type === "tool-applyPatch" ||
        part.type === "tool-runCheck" ||
        part.type === "tool-delegateToViewAgent"
      ) {
        return true;
      }

      if (
        part.type === "data-dashboard_agent_route" &&
        part.data &&
        typeof part.data === "object" &&
        "route" in part.data &&
        part.data.route === "authoring"
      ) {
        return true;
      }
    }
  }

  return false;
}

function isExploratoryAuthoringQuestion(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return /(哪些数据|什么数据|有哪些数据|能创建哪些报表|可以创建什么报表|基于这个数据源.*哪些报表|基于这个数据源.*什么报表|指标卡类型可以创建什么|有哪些指标卡|什么指标卡|可以做哪些图表|能做哪些图表|what data can|what reports can|which reports can|what KPI|what metric cards|what dashboards can)/i
    .test(trimmed);
}

function resolveRelevantSkillIds(
  latestUserRequest: string,
  skills: DashboardAgentSkillSummary[],
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
  messages: DashboardAgentMessage[],
): DashboardAgentWorkflowStage["id"] {
  const latest = findLatestWorkflow(messages);
  return latest?.active_stage ?? "read";
}
