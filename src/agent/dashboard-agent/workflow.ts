import type { DashboardDocument, DatasourceContext } from "@/contracts";
import type {
  DashboardAgentMessage,
  DashboardAgentTools,
  DashboardAgentWorkflowStage,
  DashboardAgentWorkflowSummary,
} from "@/agent/dashboard-agent/contracts/agent-contract";
import {
  buildDashboardAgentRouteDecision,
  type DashboardAgentRouteDecision,
} from "@/agent/dashboard-agent/contracts/route";
import {
  findLatestDraftOutput,
  findLatestWorkflow,
  hasPendingToolApproval,
} from "@/agent/dashboard-agent/messages/message-inspection";
import { buildDashboardAgentPrompt } from "@/agent/dashboard-agent/prompt";
import { buildDashboardAgentTools } from "@/agent/dashboard-agent/tools/tools";
import type { DashboardAgentDependencies } from "@/agent/dashboard-agent/runtime/dependencies";
import type { ViewCheckSnapshot } from "@/agent/dashboard-agent/contracts/agent-contract";

export type ActiveDashboardAgentToolName = keyof DashboardAgentTools & string;

export interface DashboardAgentRuntimeControl {
  mode: "read" | "write" | "approval";
  summary: string;
  activeTools: ActiveDashboardAgentToolName[];
}

export interface DashboardAgentWorkflow {
  latestUserRequest: string;
  routeDecision: DashboardAgentRouteDecision;
  runtimeControl: DashboardAgentRuntimeControl;
  summary: DashboardAgentWorkflowSummary;
  instructions: string;
  tools: ReturnType<typeof buildDashboardAgentTools>;
  activeTools: ActiveDashboardAgentToolName[];
}

const READ_ONLY_PATTERN =
  /(review|check|verify|inspect|look at|status|what'?s next|why|看|检查|校验|验证|评审|状态|为什么|没数据)/i;

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
  datasourceContext?: DatasourceContext | null;
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
  const runtimeControl = buildDashboardAgentRuntimeControl({
    latestUserRequest,
    routeDecision,
  });
  const tools = buildDashboardAgentTools({
    dashboard: input.dashboard,
    dashboardId: input.dashboardId,
    datasourceContext: input.datasourceContext,
    messages: input.messages,
    checks: input.checks,
    dependencies: input.dependencies,
  });

  return {
    latestUserRequest,
    routeDecision,
    runtimeControl,
    summary: buildWorkflowSummary({
      routeDecision,
      runtimeControl,
    }),
    instructions: buildDashboardAgentPrompt({
      dashboard: input.dashboard,
      dashboardId: input.dashboardId,
      datasourceContext: input.datasourceContext,
      checks: input.checks,
    }),
    tools,
    activeTools: runtimeControl.activeTools,
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
  runtimeControl: DashboardAgentRuntimeControl;
}): DashboardAgentWorkflowSummary {
  return {
    route: input.routeDecision.route,
    mode: input.runtimeControl.mode,
    active_stage: input.runtimeControl.mode,
    summary: input.runtimeControl.summary,
    active_tools: input.runtimeControl.activeTools,
    skill_ids: [],
    approval_required: input.routeDecision.route === "approval",
    stages: buildFallbackWorkflowStages(input.runtimeControl.mode),
  };
}

function buildDashboardAgentRuntimeControl(input: {
  latestUserRequest: string;
  routeDecision: DashboardAgentRouteDecision;
}): DashboardAgentRuntimeControl {
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
        "inspectDatasource",
        "runCheck",
      ],
    };
  }

  return {
    mode: "write",
    summary: "This turn can inspect state, stage contract updates, and prepare an approval patch.",
    activeTools: [
      "getViews",
      "getView",
      "getQuery",
      "getBinding",
      "inspectDatasource",
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

export function getSuggestedActiveStageFromMessages(
  messages: DashboardAgentMessage[],
): DashboardAgentWorkflowStage["id"] {
  const latest = findLatestWorkflow(messages);
  return latest?.active_stage ?? "read";
}
