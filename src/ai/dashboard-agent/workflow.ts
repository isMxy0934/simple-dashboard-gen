import type { DashboardDocument } from "@/contracts";
import type {
  DatasourceListItemSummary,
  DashboardAgentMessage,
  DashboardAgentSkillSummary,
  DashboardAgentTools,
  DashboardAgentWorkflowStage,
  DashboardAgentWorkflowSummary,
} from "@/ai/dashboard-agent/contracts/agent-contract";
import {
  buildDashboardAgentRouteDecision,
  type DashboardAgentRouteDecision,
} from "@/ai/dashboard-agent/contracts/route";
import {
  findLatestDraftOutput,
  findLatestWorkflow,
  hasPendingToolApproval,
} from "@/ai/dashboard-agent/messages/message-inspection";
import { buildDashboardAgentPrompt } from "@/ai/dashboard-agent/prompt";
import { buildDashboardAgentTools } from "@/ai/dashboard-agent/tools/tools";
import type { DashboardAgentDependencies } from "@/ai/dashboard-agent/engine/dependencies";
import type { ViewCheckSnapshot } from "@/ai/dashboard-agent/contracts/agent-contract";

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
  tools: ReturnType<typeof buildDashboardAgentTools>;
  activeTools: ActiveDashboardAgentToolName[];
}

const READ_ONLY_PATTERN =
  /(review|check|verify|inspect|look at|status|what'?s next|why|看|检查|校验|验证|评审|状态|为什么|没数据)/i;
const GENERIC_CREATE_PATTERN =
  /(create|build|generate|make|start|创建|生成|制作|新建).*(report|dashboard|chart|view|报表|仪表板|图表|视图)|^(create|build|generate|make|start|创建|生成|制作|新建).*(report|dashboard|报表|仪表板)$/i;
const SPECIFIC_REQUEST_PATTERN =
  /(datasource|schema|table|field|metric|sql|query|binding|layout|gmv|orders|trend|dimension|指标|数据源|模式|schema|表|字段|查询|绑定|布局|销售额|订单|趋势|维度)/i;
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
  dependencies?: DashboardAgentDependencies;
}): DashboardAgentWorkflow {
  const latestUserRequest =
    extractLatestUserText(input.messages) ??
    "Inspect the current dashboard and continue safely.";
  const hasPendingApproval = hasPendingToolApproval(input.messages);
  const routeDecision = buildDashboardAgentRouteDecision({
    request: latestUserRequest,
    hasRecentAuthoringContext: detectRecentAuthoringContext(input.messages),
    hasPendingProposal: hasPendingApproval,
  });
  const engineControl = buildDashboardAgentEngineControl({
    latestUserRequest,
    routeDecision,
  });
  const tools = buildDashboardAgentTools({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasources: input.datasources,
    skills: input.skills,
    messages: input.messages,
    checks: input.checks,
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
    instructions: buildDashboardAgentPrompt({
      dashboard: input.dashboard,
      dashboardId: input.dashboardId,
      datasources: input.datasources,
      skills: input.skills,
      checks: input.checks,
    }),
    tools,
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
  latestUserRequest: string;
  routeDecision: DashboardAgentRouteDecision;
}): DashboardAgentEngineControl {
  if (input.routeDecision.route === "approval") {
    return {
      mode: "approval",
      summary: "A staged patch is pending approval.",
      activeTools: ["applyPatch"],
    };
  }

  if (READ_ONLY_PATTERN.test(input.latestUserRequest)) {
    return {
      mode: "read",
      summary: "This turn is focused on inspection, lookup, and runtime checks.",
      activeTools: [
        "getViews",
        "getView",
        "getQuery",
        "getBinding",
        "getDatasources",
        "getSchemaByDatasource",
        "runCheck",
      ],
    };
  }

  if (isGenericCreateRequest(input.latestUserRequest)) {
    return {
      mode: "read",
      summary:
        "This turn should inspect the dashboard and clarify the missing data intent before staging changes.",
      activeTools: [
        "loadSkill",
        "loadSkillReference",
        "getViews",
        "getView",
        "getDatasources",
        "getSchemaByDatasource",
        "runCheck",
      ],
    };
  }

  return {
    mode: "write",
    summary: "This turn can inspect state, stage contract updates, and prepare an approval patch.",
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
      "upsertView",
      "upsertQuery",
      "upsertBinding",
      "composePatch",
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
        part.type === "tool-composePatch" ||
        part.type === "tool-applyPatch" ||
        part.type === "tool-runCheck"
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

function isGenericCreateRequest(request: string) {
  return (
    GENERIC_CREATE_PATTERN.test(request) && !SPECIFIC_REQUEST_PATTERN.test(request)
  );
}

export function getSuggestedActiveStageFromMessages(
  messages: DashboardAgentMessage[],
): DashboardAgentWorkflowStage["id"] {
  const latest = findLatestWorkflow(messages);
  return latest?.active_stage ?? "read";
}
