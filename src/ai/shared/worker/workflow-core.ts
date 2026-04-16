import type {
  MainAgentMessage,
  MainAgentSkillSummary,
  MainAgentWorkflowStage,
  MainAgentWorkflowSummary,
} from "@/ai/main-agent/contracts/agent-contract";
import type { MainAgentRouteDecision } from "@/ai/main-agent/contracts/route";

export function buildKeywordPattern(terms: string[]) {
  return new RegExp(
    terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "i",
  );
}

export const DEFAULT_WORKER_STAGES: Array<
  Pick<MainAgentWorkflowStage, "id" | "title" | "description">
> = [
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

export function buildWorkerStages(
  activeStage: MainAgentWorkflowStage["id"],
): MainAgentWorkflowStage[] {
  const activeIndex = DEFAULT_WORKER_STAGES.findIndex(
    (stage) => stage.id === activeStage,
  );

  return DEFAULT_WORKER_STAGES.map((stage, index) => ({
    ...stage,
    status:
      index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending",
  }));
}

export function buildWorkerWorkflowSummary(input: {
  routeDecision: MainAgentRouteDecision;
  mode: "read" | "write" | "approval";
  summary: string;
  activeTools: string[];
  latestUserRequest: string;
  skills: MainAgentSkillSummary[];
  resolveRelevantSkillIds: (latestUserRequest: string, skills: MainAgentSkillSummary[]) => string[];
}): MainAgentWorkflowSummary {
  return {
    route: input.routeDecision.route,
    mode: input.mode,
    active_stage: input.mode,
    summary: input.summary,
    active_tools: input.activeTools,
    skill_ids: input.resolveRelevantSkillIds(input.latestUserRequest, input.skills),
    approval_required: input.routeDecision.route === "approval",
    stages: buildWorkerStages(input.mode),
  };
}

export function detectStructuredAuthoringContext(
  messages: MainAgentMessage[],
  toolPartTypes: string[],
) {
  const recentMessages = [...messages].reverse().slice(0, 8);
  const toolTypeSet = new Set(toolPartTypes);

  for (const message of recentMessages) {
    for (const part of message.parts) {
      if (toolTypeSet.has(part.type)) {
        return true;
      }

      if (
        part.type === "data-main_agent_route" &&
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
