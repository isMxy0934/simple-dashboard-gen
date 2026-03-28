import type {
  DashboardDocument,
  DatasourceContext,
} from "../../contracts";
import type {
  AuthoringAgentMessage,
  AuthoringWorkflowStage,
  AuthoringWorkflowSummary,
  ContractStateSummary,
} from "../runtime/agent-contract";
import {
  buildAuthoringRouteDecision,
  type AuthoringRouteDecision,
} from "../runtime/authoring-route";
import {
  findLatestDraftOutput,
  hasPendingToolApproval,
} from "../runtime/message-inspection";
import {
  renderSkillResources,
} from "../skills/resource-provider";
import {
  resolveDashboardAuthoringSkillSet,
  type DashboardAuthoringSkillSet,
} from "../skills/skill-registry";
import { summarizeContractState } from "../authoring/state";
import type { DashboardAiDependencies } from "../runtime/dependencies";

export type ActiveDashboardAgentToolName =
  | "inspectContractState"
  | "inspectDatasourceContext"
  | "draftViews"
  | "draftQueryDefs"
  | "draftBindings"
  | "composePatch"
  | "applyPatch"
  | "runRuntimeCheck";

export interface AuthoringRuntimeControl {
  mode: "inspection" | "authoring";
  summary: string;
  nextStep: ContractStateSummary["next_step"];
  activeTools: ActiveDashboardAgentToolName[];
}

export interface DashboardAuthoringWorkflow {
  latestUserRequest: string;
  routeDecision: AuthoringRouteDecision;
  runtimeControl: AuthoringRuntimeControl;
  skillSet: DashboardAuthoringSkillSet;
  summary: AuthoringWorkflowSummary;
  instructions: string;
  tools: DashboardAuthoringSkillSet["tools"];
  activeTools: ActiveDashboardAgentToolName[];
}

const REVIEW_OR_STATUS_PATTERN =
  /(review|check|verify|inspect|look at|status|what'?s next|what'?s the status|看看|检查|校验|验证|评审|状态|进展|好了没)/i;
const WORKFLOW_STAGE_ORDER: ContractStateSummary["next_step"][] = [
  "layout",
  "data",
  "repair",
  "review",
];
const WORKFLOW_STAGE_COPY: Record<
  ContractStateSummary["next_step"],
  { title: string; description: string }
> = {
  layout: {
    title: "Shape Views",
    description: "Define the dashboard views, layout rhythm, and the visual framing of each panel.",
  },
  data: {
    title: "Wire Data",
    description: "Draft query definitions, choose mock or live bindings, and map fields into each view.",
  },
  repair: {
    title: "Repair Runtime",
    description: "Run checks, inspect broken bindings, and close validation gaps before approval.",
  },
  review: {
    title: "Review And Approve",
    description: "Summarize the final proposal, gather approval, and prepare the dashboard for publish.",
  },
};

export function createDashboardAuthoringWorkflow(input: {
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages: AuthoringAgentMessage[];
  dependencies?: DashboardAiDependencies;
}): DashboardAuthoringWorkflow {
  const contractState = summarizeContractState(input.dashboard);
  const latestUserRequest =
    extractLatestUserText(input.messages) ??
    "Review the current dashboard and decide the next safe step.";
  const hasPendingApproval = hasPendingToolApproval(input.messages);
  const routeDecision = buildAuthoringRouteDecision({
    request: latestUserRequest,
    hasRecentAuthoringContext: detectRecentAuthoringContext(input.messages),
    hasPendingProposal: hasPendingApproval,
  });
  const runtimeControl = buildAuthoringRuntimeControl({
    contractState,
    datasourceContext: input.datasourceContext,
    latestUserRequest,
  });
  const skillSet = resolveDashboardAuthoringSkillSet({
    dashboard: input.dashboard,
    datasourceContext: input.datasourceContext,
    messages: input.messages,
    contractState,
    routeDecision,
    runtimeMode: runtimeControl.mode,
    dependencies: input.dependencies,
  });

  return {
    latestUserRequest,
    routeDecision,
    runtimeControl,
    skillSet,
    summary: buildWorkflowSummary({
      routeDecision,
      runtimeControl,
      skillSet,
    }),
    instructions: buildWorkflowInstructions({
      skillSet,
      routeDecision,
      runtimeControl,
    }),
    tools: skillSet.tools,
    activeTools: runtimeControl.activeTools,
  };
}

function buildWorkflowSummary(input: {
  routeDecision: AuthoringRouteDecision;
  runtimeControl: AuthoringRuntimeControl;
  skillSet: DashboardAuthoringSkillSet;
}): AuthoringWorkflowSummary {
  const activeStage = resolveActiveWorkflowStage(input);

  return {
    route: input.routeDecision.route,
    mode: input.runtimeControl.mode,
    next_step: input.runtimeControl.nextStep,
    active_stage: activeStage,
    summary: input.runtimeControl.summary,
    active_tools: input.runtimeControl.activeTools,
    skill_ids: input.skillSet.skills.map((skill) => skill.id),
    approval_required: input.routeDecision.route === "approval",
    stages: buildWorkflowStages(activeStage),
  };
}

export function buildDashboardConversationReply(input: {
  dashboard: DashboardDocument;
  messages: AuthoringAgentMessage[];
  routeDecision: AuthoringRouteDecision;
}) {
  const dashboardName = input.dashboard.dashboard_spec.dashboard.name;
  const latestProposal = findLatestDraftOutput(input.messages);

  switch (input.routeDecision.route) {
    case "approval":
      return latestProposal
        ? `当前已经有一个待审批提案「${latestProposal.suggestion.title}」。请先审查提案，再通过审批卡批准或拒绝 applyPatch。`
        : "当前没有待审批的变更提案。告诉我你想创建、修改或检查什么 dashboard 内容。";
    case "chat":
      return `可以。告诉我你想在「${dashboardName}」里创建什么图表、怎么调整布局，或者要检查哪部分数据绑定。`;
    default:
      return `告诉我你想在「${dashboardName}」里做什么 dashboard 变更，我会准备一个可审批的提案。`;
  }
}

function buildWorkflowInstructions(input: {
  skillSet: DashboardAuthoringSkillSet;
  routeDecision: AuthoringRouteDecision;
  runtimeControl: AuthoringRuntimeControl;
}) {
  const renderedResources = renderSkillResources(input.skillSet.resources);

  return [
    ...input.skillSet.instructions,
    ...(renderedResources ? ["", renderedResources] : []),
    "",
    "Current route decision:",
    JSON.stringify(input.routeDecision, null, 2),
    "",
    "Current runtime control:",
    JSON.stringify(
      {
        mode: input.runtimeControl.mode,
        summary: input.runtimeControl.summary,
        next_step: input.runtimeControl.nextStep,
        active_tools: input.runtimeControl.activeTools,
      },
      null,
      2,
    ),
    "",
    "Stay inside the current runtime control and only use tools that are currently active.",
    "In inspection mode, prefer status/review answers and avoid drafting unless the user explicitly asks for a change.",
    "In authoring mode, inspect when helpful, then draft when the user is ready, then use composePatch when the staged candidate is ready, then use applyPatch to request approval.",
  ].join("\n");
}

function buildAuthoringRuntimeControl(input: {
  contractState: ContractStateSummary;
  datasourceContext?: DatasourceContext | null;
  latestUserRequest: string;
}): AuthoringRuntimeControl {
  const hasDatasource = Boolean(input.datasourceContext);
  const hasCurrentViews = input.contractState.views.length > 0;
  const hasCurrentLiveData =
    input.contractState.query_ids.length > 0 || input.contractState.binding_count > 0;
  const reviewOnly = REVIEW_OR_STATUS_PATTERN.test(input.latestUserRequest);
  const activeTools: ActiveDashboardAgentToolName[] = [
    "inspectContractState",
    "inspectDatasourceContext",
  ];

  if (reviewOnly) {
    if (hasCurrentViews || hasCurrentLiveData) {
      activeTools.push("runRuntimeCheck");
    }

    return {
      mode: "inspection",
      summary:
        "This turn is narrowed to dashboard status, inspection, and runtime verification.",
      nextStep: input.contractState.next_step,
      activeTools: dedupeTools(activeTools),
    };
  }

  activeTools.push("draftViews", "composePatch");

  if (hasDatasource) {
    activeTools.push("draftQueryDefs");
  }

  if (hasCurrentViews || hasCurrentLiveData) {
    activeTools.push("draftBindings");
  }

  if (
    input.contractState.next_step === "repair" ||
    input.contractState.next_step === "review"
  ) {
    activeTools.push("runRuntimeCheck");
  }

  return {
    mode: "authoring",
    summary:
      "This turn can inspect, draft, and compose a staged dashboard patch within the active tool set.",
    nextStep: input.contractState.next_step,
    activeTools: dedupeTools(activeTools),
  };
}

function resolveActiveWorkflowStage(input: {
  routeDecision: AuthoringRouteDecision;
  runtimeControl: AuthoringRuntimeControl;
}): ContractStateSummary["next_step"] {
  if (input.routeDecision.route === "approval") {
    return "review";
  }

  return input.runtimeControl.nextStep;
}

function buildWorkflowStages(
  activeStage: ContractStateSummary["next_step"],
): AuthoringWorkflowStage[] {
  const activeStageIndex = WORKFLOW_STAGE_ORDER.indexOf(activeStage);

  return WORKFLOW_STAGE_ORDER.map((stageId, index) => {
    const status =
      index < activeStageIndex
        ? "complete"
        : index === activeStageIndex
          ? "active"
          : "pending";

    return {
      id: stageId,
      title: WORKFLOW_STAGE_COPY[stageId].title,
      description: WORKFLOW_STAGE_COPY[stageId].description,
      status,
    };
  });
}

function dedupeTools(
  tools: ActiveDashboardAgentToolName[],
): ActiveDashboardAgentToolName[] {
  return tools.filter((toolName, index, array) => array.indexOf(toolName) === index);
}

function extractLatestUserText(messages: AuthoringAgentMessage[]): string | null {
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

function detectRecentAuthoringContext(messages: AuthoringAgentMessage[]) {
  const recentMessages = [...messages].reverse().slice(0, 8);
  const authoringPattern =
    /(create|build|generate|make|design|add|edit|update|fix|repair|review|check|bind|query|dashboard|chart|view|layout|sql|gmv|orders|创建|生成|制作|设计|新增|修改|更新|修复|检查|绑定|查询|仪表板|图表|视图|布局|数据)/i;

  for (const message of recentMessages) {
    for (const part of message.parts) {
      if (part.type === "text" && authoringPattern.test(part.text)) {
        return true;
      }

      if (
        part.type === "tool-draftViews" ||
        part.type === "tool-draftQueryDefs" ||
        part.type === "tool-draftBindings" ||
        part.type === "tool-composePatch" ||
        part.type === "tool-applyPatch" ||
        part.type === "tool-runRuntimeCheck"
      ) {
        return true;
      }

      if (
        part.type === "data-authoring_route" &&
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
